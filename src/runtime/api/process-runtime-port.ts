import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { RuntimeCaptureBindings } from '../../model-capture/runtime-bindings.js'
import { createServer, type Server, type Socket } from 'node:net'
import { FramedSocket } from '../../ipc/framed-socket.js'
import type { IpcEnvelope } from '../../ipc/protobuf-envelope.js'
import type {
  RuntimeCancelResult,
  RuntimeElicitationContent,
  RuntimePlatformToolTransport,
  RuntimePromptInput,
  RuntimeStateSnapshot,
} from '../../ports/runtime-port.js'
import type { SessionCapabilities } from '../../types/ws-protocol.js'
import { createChildLogger } from '../../shared/logger.js'
import { resolveRuntimeEntryPath } from '../service/entry-url.js'
import {
  asRuntimeCancelResult,
  closeRuntimeServer,
  createRuntimeIpcEndpoint,
  delay,
  listenOnRuntimeEndpoint,
  removeRuntimeEndpoint,
  resolvePlatformToolBaseUrl,
  resolveRuntimeRequestTimeoutMs,
  runtimeErrorMessage,
  type CreateProcessRuntimePortOptions,
  type ProcessRuntimePort,
  type RuntimePendingRequest,
  toRuntimeEnvelope,
  withRuntimeTimeout,
} from './process-runtime-support.js'
import {
  asSessionCapabilities,
  isRuntimeControlPayload,
  type RuntimeCommand,
  type RuntimeControlPayload,
} from '../service/protocol.js'

export type { RuntimeDoneEvent, RuntimePersistenceUpdate } from '../service/protocol.js'
export { resolveRuntimeRequestTimeoutMs, type CreateProcessRuntimePortOptions, type ProcessRuntimePort } from './process-runtime-support.js'

const log = createChildLogger('runtime-process')

export async function createProcessRuntimePort(options: CreateProcessRuntimePortOptions): Promise<ProcessRuntimePort> {
  const controller = new ProcessRuntimePortController(options)
  await controller.start()
  return controller
}

class ProcessRuntimePortController implements ProcessRuntimePort {
  readonly platformToolTransport: RuntimePlatformToolTransport = {
    type: 'http',
    baseUrl: resolvePlatformToolBaseUrl(),
  }
  private readonly endpoint = createRuntimeIpcEndpoint()
  private readonly token = randomUUID()
  private readonly pending = new Map<string, RuntimePendingRequest>()
  private readonly captureBindings = new RuntimeCaptureBindings()
  private readonly sessionIngress = new Map<string, Promise<void>>()
  private readonly maxFrameBytes: number
  private server?: Server
  private child?: ChildProcess
  private channel?: FramedSocket
  private ready: Promise<void> = Promise.resolve()
  private resolveReady?: () => void
  private rejectReady?: (error: Error) => void
  private readyPending = false
  private closing = false
  private currentGeneration = 0
  private restartTimer?: NodeJS.Timeout
  private spawnStartedAt = 0
  private restartStartedAt?: number

  constructor(private readonly options: CreateProcessRuntimePortOptions) {
    this.maxFrameBytes = options.maxFrameBytes ?? 16 * 1024 * 1024
  }

  get generation(): number {
    return this.currentGeneration
  }

  async start(): Promise<void> {
    this.server = createServer((socket) => this.acceptSocket(socket))
    removeRuntimeEndpoint(this.endpoint)
    await listenOnRuntimeEndpoint(this.server, this.endpoint)
    this.resetReady()
    this.spawnChild()
    await withRuntimeTimeout(this.ready, this.options.readyTimeoutMs ?? 5_000, 'Runtime readiness timed out')
  }

  ensureSession(snapshot: RuntimeStateSnapshot, options: { emitLifecycle?: boolean } = {}): Promise<string> {
    return this.request({ operation: 'ensure', snapshot, emitLifecycle: options.emitLifecycle }) as Promise<string>
  }

  prompt(input: RuntimePromptInput): Promise<void> {
    return this.request({ operation: 'prompt', ...input }) as Promise<void>
  }

  async cancelPrompt(agentId: string, sessionId: string): Promise<RuntimeCancelResult> {
    return asRuntimeCancelResult(await this.request({ operation: 'cancel', agentId, sessionId }))
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
    const closeError = new Error('Runtime process closed')
    this.readyPending = false
    this.rejectReady?.(closeError)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    await this.channel?.send(toRuntimeEnvelope({ type: 'control', operation: 'stop' })).catch(() => undefined)
    await Promise.race([this.waitForExit(), delay(1_000)])
    if (this.child?.exitCode == null && this.child?.signalCode == null) this.child?.kill()
    await this.channel?.close().catch(() => undefined)
    this.failPending(closeError)
    if (this.server) await closeRuntimeServer(this.server)
    removeRuntimeEndpoint(this.endpoint)
  }

  private spawnChild(): void {
    const entry = resolveRuntimeEntryPath(import.meta.url)
    this.spawnStartedAt = Date.now()
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
    log.info({ pid: child.pid, nextGeneration: this.currentGeneration + 1 }, 'Runtime process spawned')
    child.once('error', (error) => {
      this.readyPending = false
      this.rejectReady?.(error)
    })
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = undefined
      const error = new Error(`Runtime process exited (code=${code}, signal=${signal})`)
      const staleChannel = this.channel
      this.channel = undefined
      void staleChannel?.close().catch(() => undefined)
      this.failPending(error)
      this.captureBindings.clear()
      if (!this.closing) {
        this.beginRestartWait()
        const restartDelayMs = this.options.restartDelayMs ?? 250
        log.warn({
          pid: child.pid,
          code,
          signal,
          generation: this.currentGeneration,
          restartDelayMs,
        }, 'Runtime process exited; scheduling restart')
        this.restartTimer = setTimeout(() => {
          this.restartTimer = undefined
          this.spawnChild()
        }, restartDelayMs)
      }
    })
  }

  private acceptSocket(socket: Socket): void {
    if (this.channel) {
      socket.destroy(new Error('Runtime IPC already connected'))
      return
    }
    const channel = new FramedSocket(socket, { maxFrameBytes: this.maxFrameBytes })
    const channelChild = this.child
    this.channel = channel
    channel.onMessage((message) => {
      void this.handleMessage(message).catch((error) => {
        log.error({ err: error, pid: channelChild?.pid, generation: this.currentGeneration }, 'Runtime IPC message handling failed')
        if (channelChild && this.child === channelChild && channelChild.exitCode == null && channelChild.signalCode == null) {
          channelChild.kill()
        }
      })
    })
    channel.onError((error) => log.warn({ err: error }, 'Runtime IPC error'))
    socket.once('close', () => {
      if (this.channel !== channel) return
      this.channel = undefined
      if (!this.closing && this.currentGeneration > 0) this.beginRestartWait()
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
      this.readyPending = false
      this.resolveReady?.()
      log.info({
        pid: this.child?.pid,
        generation: this.currentGeneration,
        startupMs: Date.now() - this.spawnStartedAt,
        restartDurationMs: this.restartStartedAt === undefined ? undefined : Date.now() - this.restartStartedAt,
      }, 'Runtime process ready')
      this.restartStartedAt = undefined
      return
    }
    if (payload.type === 'result') {
      this.captureBindings.endRequest(payload.requestId)
      const pending = this.pending.get(payload.requestId)
      if (!pending) return
      this.pending.delete(payload.requestId)
      if (pending.timer) clearTimeout(pending.timer)
      if (payload.error) pending.reject(new Error(payload.error))
      else pending.resolve(payload.result)
      return
    }
    if (payload.type === 'persistence') {
      try {
        await this.chainIngress(payload.event.sessionId, () => this.options.onPersistenceUpdate(payload.event))
      } catch (error) {
        log.error({
          err: error,
          sessionId: payload.event.sessionId,
          agentId: payload.event.agentId,
          generation: this.currentGeneration,
        }, 'Runtime persistence update handling failed; keeping shared Runtime alive')
      }
      return
    }
    if (payload.type === 'done') {
      const run = this.chainIngress(payload.event.sessionId, () => this.options.onDone(payload.event))
      await run.then(
        () => this.send({ type: 'done.ack', requestId: payload.requestId }),
        (error) => this.send({ type: 'done.ack', requestId: payload.requestId, error: runtimeErrorMessage(error) }),
      )
      return
    }
    if (payload.type === 'agent-status') {
      this.captureBindings.agentStatus(payload.event)
      await this.options.onAgentStatus?.(payload.event)
    }
  }

  private async request(command: RuntimeCommand): Promise<unknown> {
    if (this.closing) throw new Error('Runtime process is unavailable')
    if (!this.channel) {
      await withRuntimeTimeout(
        this.ready,
        this.options.readyTimeoutMs ?? 5_000,
        `Runtime restart timed out before ${command.operation}`,
      )
    }
    if (this.closing || !this.channel) throw new Error('Runtime process is unavailable')
    return this.sendRequest(command)
  }

  private sendRequest(command: RuntimeCommand): Promise<unknown> {
    const requestId = randomUUID()
    this.captureBindings.beginRequest(requestId, 'snapshot' in command ? command.snapshot.runtime.captureBinding : undefined)
    const timeoutMs = resolveRuntimeRequestTimeoutMs(command.operation, this.options)
    return new Promise((resolve, reject) => {
      const timer = timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.pending.delete(requestId)
            reject(new Error(`Runtime request timed out: ${command.operation}`))
          }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      void this.send({ type: 'request', requestId, command }).catch((error) => {
        this.captureBindings.endRequest(requestId)
        if (timer) clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error)
      })
    })
  }

  private resetReady(): void {
    this.readyPending = true
    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void ready.catch(() => undefined)
    this.ready = ready
  }

  private beginRestartWait(): void {
    if (this.restartStartedAt === undefined) this.restartStartedAt = Date.now()
    if (!this.readyPending) this.resetReady()
  }

  private chainIngress(sessionId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.sessionIngress.get(sessionId) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tracked = next.catch(() => undefined).finally(() => {
      if (this.sessionIngress.get(sessionId) === tracked) this.sessionIngress.delete(sessionId)
    })
    this.sessionIngress.set(sessionId, tracked)
    return next
  }

  private send(payload: RuntimeControlPayload): Promise<void> {
    if (!this.channel) return Promise.reject(new Error('Runtime IPC is unavailable'))
    return this.channel.send(toRuntimeEnvelope(payload))
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
