import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FramedSocket } from '../../ipc/framed-socket.js'
import type { IpcEnvelope } from '../../ipc/protobuf-envelope.js'
import type {
  RuntimeElicitationContent,
  RuntimePlatformToolTransport,
  RuntimePort,
  RuntimePromptInput,
  RuntimeStateSnapshot,
} from '../../ports/runtime-port.js'
import type { SessionCapabilities } from '../../types/ws-protocol.js'
import { createChildLogger } from '../../shared/logger.js'
import { resolveRuntimeEntryPath } from '../service/entry-url.js'
import {
  asSessionCapabilities,
  isRuntimeControlPayload,
  type RuntimeCommand,
  type RuntimeControlPayload,
  type RuntimeAgentStatusEvent,
  type RuntimeDoneEvent,
  type RuntimePersistenceUpdate,
} from '../service/protocol.js'

export type { RuntimeDoneEvent, RuntimePersistenceUpdate } from '../service/protocol.js'

const log = createChildLogger('runtime-process')

export interface CreateProcessRuntimePortOptions {
  realtimeStreamEndpoint: string
  realtimeStreamToken: string
  onPersistenceUpdate: (event: RuntimePersistenceUpdate) => Promise<void>
  onDone: (event: RuntimeDoneEvent) => Promise<void>
  onAgentStatus?: (event: RuntimeAgentStatusEvent) => void | Promise<void>
  readyTimeoutMs?: number
  requestTimeoutMs?: number
  maxFrameBytes?: number
  restartDelayMs?: number
  idleSweepIntervalMs?: number
  sessionIdleMs?: number
  agentIdleMs?: number
}

export interface ProcessRuntimePort extends RuntimePort {
  readonly generation: number
  terminateForTest(): Promise<void>
  waitForRestart(previousGeneration: number, timeoutMs?: number): Promise<void>
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer?: NodeJS.Timeout
}

export async function createProcessRuntimePort(
  options: CreateProcessRuntimePortOptions,
): Promise<ProcessRuntimePort> {
  const controller = new ProcessRuntimePortController(options)
  await controller.start()
  return controller
}

class ProcessRuntimePortController implements ProcessRuntimePort {
  readonly platformToolTransport: RuntimePlatformToolTransport = {
    type: 'http',
    baseUrl: resolvePlatformToolBaseUrl(),
  }
  private readonly endpoint = createIpcEndpoint()
  private readonly token = randomUUID()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly sessionIngress = new Map<string, Promise<void>>()
  private readonly maxFrameBytes: number
  private server?: Server
  private child?: ChildProcess
  private channel?: FramedSocket
  private ready?: Promise<void>
  private resolveReady?: () => void
  private rejectReady?: (error: Error) => void
  private closing = false
  private currentGeneration = 0
  private restartTimer?: NodeJS.Timeout

  constructor(private readonly options: CreateProcessRuntimePortOptions) {
    this.maxFrameBytes = options.maxFrameBytes ?? 16 * 1024 * 1024
  }

  get generation(): number {
    return this.currentGeneration
  }

  async start(): Promise<void> {
    this.server = createServer((socket) => this.acceptSocket(socket))
    removeEndpoint(this.endpoint)
    await listen(this.server, this.endpoint)
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.spawnChild()
    await withTimeout(this.ready, this.options.readyTimeoutMs ?? 5_000, 'Runtime readiness timed out')
  }

  ensureSession(snapshot: RuntimeStateSnapshot, options: { emitLifecycle?: boolean } = {}): Promise<string> {
    return this.request({ operation: 'ensure', snapshot, emitLifecycle: options.emitLifecycle }) as Promise<string>
  }

  prompt(input: RuntimePromptInput): Promise<void> {
    return this.request({ operation: 'prompt', ...input }) as Promise<void>
  }

  cancelPrompt(agentId: string, sessionId: string): Promise<void> {
    return this.request({ operation: 'cancel', agentId, sessionId }) as Promise<void>
  }

  closeSession(agentId: string, sessionId: string): Promise<void> {
    return this.request({ operation: 'close-session', agentId, sessionId }) as Promise<void>
  }

  forkSession(snapshot: RuntimeStateSnapshot, sourceAcpSessionId: string): Promise<string> {
    return this.request({ operation: 'fork', snapshot, sourceAcpSessionId }) as Promise<string>
  }

  setModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    return this.request({ operation: 'set-model', agentId, sessionId, modelId }) as Promise<void>
  }

  setMode(agentId: string, sessionId: string, modeId: string): Promise<void> {
    return this.request({ operation: 'set-mode', agentId, sessionId, modeId }) as Promise<void>
  }

  setConfig(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void> {
    return this.request({ operation: 'set-config', agentId, sessionId, configId, value }) as Promise<void>
  }

  async getSessionCapabilities(agentId: string, sessionId: string): Promise<SessionCapabilities | undefined> {
    return asSessionCapabilities(await this.request({ operation: 'capabilities', agentId, sessionId }))
  }

  resolvePermission(
    sessionId: string,
    requestId: string,
    optionId?: string,
    cancelled?: boolean,
  ): Promise<boolean> {
    return this.request({ operation: 'permission', sessionId, requestId, optionId, cancelled }) as Promise<boolean>
  }

  resolveElicitation(
    sessionId: string,
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: RuntimeElicitationContent,
  ): Promise<boolean> {
    return this.request({ operation: 'elicitation', sessionId, requestId, action, content }) as Promise<boolean>
  }

  async drain(): Promise<void> {
    await this.request({ operation: 'drain' })
    await Promise.all(this.sessionIngress.values())
  }

  async terminateForTest(): Promise<void> {
    if (!this.child) return
    const child = this.child
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.kill()
    })
  }

  async waitForRestart(previousGeneration: number, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.currentGeneration > previousGeneration) return
      await delay(10)
    }
    throw new Error('Runtime restart timed out')
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    await this.channel?.send(toEnvelope({ type: 'control', operation: 'stop' })).catch(() => undefined)
    await Promise.race([this.waitForExit(), delay(1_000)])
    if (this.child?.exitCode == null && this.child?.signalCode == null) this.child?.kill()
    await this.channel?.close().catch(() => undefined)
    this.failPending(new Error('Runtime process closed'))
    if (this.server) await closeServer(this.server)
    removeEndpoint(this.endpoint)
  }

  private spawnChild(): void {
    const entry = resolveRuntimeEntryPath(import.meta.url)
    const child = fork(entry, [], {
      env: {
        ...process.env,
        AI_IDE_RUNTIME_IPC_ENDPOINT: this.endpoint,
        AI_IDE_RUNTIME_INTERNAL_TOKEN: this.token,
        AI_IDE_RUNTIME_STREAM_ENDPOINT: this.options.realtimeStreamEndpoint,
        AI_IDE_RUNTIME_STREAM_TOKEN: this.options.realtimeStreamToken,
        AI_IDE_RUNTIME_MAX_FRAME_BYTES: String(this.maxFrameBytes),
        AI_IDE_RUNTIME_IDLE_SWEEP_MS: String(this.options.idleSweepIntervalMs ?? 5 * 60 * 1000),
        AI_IDE_RUNTIME_SESSION_IDLE_MS: String(this.options.sessionIdleMs ?? 30 * 60 * 1000),
        AI_IDE_RUNTIME_AGENT_IDLE_MS: String(this.options.agentIdleMs ?? 60 * 60 * 1000),
      },
      execArgv: entry.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    this.child = child
    child.once('error', (error) => this.rejectReady?.(error))
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = undefined
      const error = new Error(`Runtime process exited (code=${code}, signal=${signal})`)
      this.failPending(error)
      if (!this.closing) {
        this.restartTimer = setTimeout(() => {
          this.restartTimer = undefined
          this.ready = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve
            this.rejectReady = reject
          })
          this.spawnChild()
        }, this.options.restartDelayMs ?? 250)
      }
    })
  }

  private acceptSocket(socket: Socket): void {
    if (this.channel) {
      socket.destroy(new Error('Runtime IPC already connected'))
      return
    }
    const channel = new FramedSocket(socket, { maxFrameBytes: this.maxFrameBytes })
    this.channel = channel
    channel.onMessage((message) => { void this.handleMessage(message) })
    channel.onError((error) => log.warn({ err: error }, 'Runtime IPC error'))
    socket.once('close', () => {
      if (this.channel === channel) this.channel = undefined
    })
  }

  private async handleMessage(envelope: IpcEnvelope): Promise<void> {
    if (!isRuntimeControlPayload(envelope.payload)) return
    const payload = envelope.payload
    if (payload.type === 'hello') {
      if (payload.token !== this.token) {
        await this.channel?.close()
        return
      }
      await this.send({ type: 'hello.ack' })
      return
    }
    if (payload.type === 'ready') {
      this.currentGeneration += 1
      this.resolveReady?.()
      return
    }
    if (payload.type === 'result') {
      const pending = this.pending.get(payload.requestId)
      if (!pending) return
      this.pending.delete(payload.requestId)
      if (pending.timer) clearTimeout(pending.timer)
      if (payload.error) pending.reject(new Error(payload.error))
      else pending.resolve(payload.result)
      return
    }
    if (payload.type === 'persistence') {
      this.chainIngress(payload.event.sessionId, () => this.options.onPersistenceUpdate(payload.event))
      return
    }
    if (payload.type === 'done') {
      const run = this.chainIngress(payload.event.sessionId, () => this.options.onDone(payload.event))
      await run.then(
        () => this.send({ type: 'done.ack', requestId: payload.requestId }),
        (error) => this.send({ type: 'done.ack', requestId: payload.requestId, error: errorMessage(error) }),
      )
      return
    }
    if (payload.type === 'agent-status') await this.options.onAgentStatus?.(payload.event)
  }

  private request(command: RuntimeCommand): Promise<unknown> {
    if (this.closing || !this.channel) return Promise.reject(new Error('Runtime process is unavailable'))
    const requestId = randomUUID()
    const timeoutMs = command.operation === 'prompt'
      ? undefined
      : this.options.requestTimeoutMs ?? 30_000
    return new Promise((resolve, reject) => {
      const timer = timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.pending.delete(requestId)
            reject(new Error(`Runtime request timed out: ${command.operation}`))
          }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      void this.send({ type: 'request', requestId, command }).catch((error) => {
        if (timer) clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error)
      })
    })
  }

  private chainIngress(sessionId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.sessionIngress.get(sessionId) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tracked = next.finally(() => {
      if (this.sessionIngress.get(sessionId) === tracked) this.sessionIngress.delete(sessionId)
    })
    this.sessionIngress.set(sessionId, tracked)
    return next
  }

  private send(payload: RuntimeControlPayload): Promise<void> {
    if (!this.channel) return Promise.reject(new Error('Runtime IPC is unavailable'))
    return this.channel.send(toEnvelope(payload))
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private waitForExit(): Promise<void> {
    if (!this.child) return Promise.resolve()
    return new Promise((resolve) => this.child?.once('exit', () => resolve()))
  }
}

function resolvePlatformToolBaseUrl(): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim()
  return configured || `http://127.0.0.1:${process.env.PORT ?? '18800'}`
}

function toEnvelope(payload: RuntimeControlPayload): IpcEnvelope {
  return { version: '1', kind: payload.type, timestamp: Date.now(), payload: payload as unknown as Record<string, unknown> }
}

function createIpcEndpoint(): string {
  const suffix = `${process.pid}-${randomUUID()}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\ai-ide-runtime-${suffix}`
    : join(tmpdir(), `ai-ide-runtime-${suffix}.sock`)
}

function removeEndpoint(endpoint: string): void {
  if (process.platform !== 'win32' && existsSync(endpoint)) rmSync(endpoint, { force: true })
}

function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, resolve)
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([promise, delay(timeoutMs).then(() => { throw new Error(message) })])
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
