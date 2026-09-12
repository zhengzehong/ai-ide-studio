import { fork, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { FramedSocket } from '../ipc/framed-socket.js'
import type { IpcEnvelope } from '../ipc/protobuf-envelope.js'
import { createChildLogger } from '../shared/logger.js'
import { resolveRealtimeEntryPath } from './entry-url.js'
import {
  isRealtimeIpcPayload,
  type RealtimeConnectionClaims,
  type RealtimeDelivery,
  type RealtimeIpcPayload,
  type RealtimeRpcState,
} from './protocol.js'
import type { ClientMessage, ServerMessage } from '../types/ws-protocol.js'

const log = createChildLogger('realtime-process')

export interface RealtimeAuthRequest {
  token?: string
  shareToken?: string
  guestId?: string
  guestName?: string
}

export interface RealtimeLegacyRpcRequest {
  connectionId: string
  message: ClientMessage
  state: RealtimeRpcState
  emit: (message: ServerMessage) => void
}

export interface CreateRealtimeProcessOptions {
  host: string
  port: number
  legacyRpcEnabled?: boolean
  maxQueueMessages?: number
  maxQueueBytes?: number
  maxBufferedBytes?: number
  maxFrameBytes?: number
  flushIntervalMs?: number
  restartDelayMs?: number
  readyTimeoutMs?: number
  authenticate: (request: RealtimeAuthRequest) => Promise<RealtimeConnectionClaims | undefined>
  dispatchLegacyRpc: (request: RealtimeLegacyRpcRequest) => Promise<readonly string[]>
}

export interface RealtimeProcessHandle {
  readonly port: number
  readonly endpointUrl: string
  readonly generation: number
  readonly runtimeStreamEndpoint: string
  readonly runtimeStreamToken: string
  onEndpointChange(listener: (endpointUrl: string) => void): () => void
  sendDelivery(delivery: RealtimeDelivery): Promise<void>
  terminateForTest(): Promise<void>
  waitForRestart(previousGeneration: number, timeoutMs?: number): Promise<void>
  close(): Promise<void>
}

export async function createRealtimeProcess(
  options: CreateRealtimeProcessOptions,
): Promise<RealtimeProcessHandle> {
  const controller = new RealtimeProcessController(options)
  await controller.start()
  return controller
}

class RealtimeProcessController implements RealtimeProcessHandle {
  private readonly endpoint = createIpcEndpoint()
  private readonly internalToken = randomUUID()
  readonly runtimeStreamEndpoint = createRuntimeStreamEndpoint()
  readonly runtimeStreamToken = randomUUID()
  private readonly maxFrameBytes: number
  private server?: Server
  private child?: ChildProcess
  private channel?: FramedSocket
  private handshaken = false
  private actualPort = 0
  private currentGeneration = 0
  private restartTimer?: NodeJS.Timeout
  private closing = false
  private readyWaiters = new Set<() => void>()
  private exitWaiters = new Set<() => void>()
  private endpointListeners = new Set<(endpointUrl: string) => void>()

  constructor(private readonly options: CreateRealtimeProcessOptions) {
    this.maxFrameBytes = options.maxFrameBytes ?? 16 * 1024 * 1024
  }

  get port(): number {
    return this.actualPort
  }

  get endpointUrl(): string {
    return `ws://${publicHost(this.options.host)}:${this.actualPort}`
  }

  get generation(): number {
    return this.currentGeneration
  }

  onEndpointChange(listener: (endpointUrl: string) => void): () => void {
    this.endpointListeners.add(listener)
    if (this.actualPort > 0) listener(this.endpointUrl)
    return () => this.endpointListeners.delete(listener)
  }

  async start(): Promise<void> {
    this.server = createServer((socket) => this.acceptSocket(socket))
    await listen(this.server, this.endpoint)
    this.spawnChild()
    await this.waitUntilReady(this.options.readyTimeoutMs ?? 5_000)
  }

  sendDelivery(delivery: RealtimeDelivery): Promise<void> {
    return this.send({ type: 'event', delivery })
  }

  async terminateForTest(): Promise<void> {
    const child = this.child
    if (!child) return
    const exited = this.waitForExit()
    child.kill()
    await exited
  }

  async waitForRestart(previousGeneration: number, timeoutMs = 5_000): Promise<void> {
    if (this.currentGeneration > previousGeneration) return
    await withTimeout(new Promise<void>((resolve) => {
      const check = (): void => {
        if (this.currentGeneration > previousGeneration) resolve()
        else this.readyWaiters.add(check)
      }
      this.readyWaiters.add(check)
    }), timeoutMs, 'Realtime restart timed out')
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    const child = this.child
    if (this.channel && child) {
      await this.send({ type: 'control', operation: 'stop' }).catch(() => undefined)
      await Promise.race([this.waitForExit(), delay(1_000)])
    }
    if (child?.exitCode == null && child?.signalCode == null) child?.kill()
    await this.channel?.close().catch(() => undefined)
    this.channel = undefined
    this.endpointListeners.clear()
    if (this.server) await closeServer(this.server)
    this.server = undefined
    removeIpcEndpoint(this.endpoint)
    removeIpcEndpoint(this.runtimeStreamEndpoint)
  }

  private acceptSocket(socket: Socket): void {
    if (this.channel) {
      socket.destroy(new Error('Realtime IPC already connected'))
      return
    }
    this.handshaken = false
    const channel = new FramedSocket(socket, { maxFrameBytes: this.maxFrameBytes })
    const channelChild = this.child
    this.channel = channel
    channel.onMessage((message) => {
      void this.handleMessage(message).catch((error) => {
        log.error({ err: error, pid: channelChild?.pid, generation: this.currentGeneration }, 'Realtime IPC message handling failed')
        if (channelChild && this.child === channelChild && channelChild.exitCode == null && channelChild.signalCode == null) {
          channelChild.kill()
        }
      })
    })
    channel.onError((error) => log.warn({ err: error }, 'Realtime IPC channel error'))
    socket.once('close', () => {
      if (this.channel === channel) this.channel = undefined
    })
  }

  private async handleMessage(envelope: IpcEnvelope): Promise<void> {
    if (!isRealtimeIpcPayload(envelope.payload)) return
    const payload = envelope.payload
    if (payload.type === 'hello') {
      if (payload.token !== this.internalToken) {
        await this.channel?.close()
        return
      }
      this.handshaken = true
      await this.send({ type: 'hello.ack' })
      return
    }
    if (!this.handshaken) return
    if (payload.type === 'ready') {
      this.actualPort = payload.port
      this.currentGeneration += 1
      for (const resolve of this.readyWaiters) resolve()
      this.readyWaiters.clear()
      this.notifyEndpointChange()
      log.info({ port: payload.port, generation: this.currentGeneration }, 'Realtime process ready')
      return
    }
    if (payload.type === 'auth.request') {
      const claims = await this.options.authenticate(payload)
      await this.send({
        type: 'auth.result',
        connectionId: payload.connectionId,
        claims,
        error: claims ? undefined : 'Unauthorized',
      })
      return
    }
    if (payload.type === 'rpc.request') {
      await this.dispatchRpc(payload)
    }
  }

  private async dispatchRpc(payload: Extract<RealtimeIpcPayload, { type: 'rpc.request' }>): Promise<void> {
    let subscriptions: readonly string[] = payload.state.subscriptions
    try {
      subscriptions = await this.options.dispatchLegacyRpc({
        connectionId: payload.connectionId,
        message: payload.message,
        state: payload.state,
        emit: (message) => {
          void this.send({
            type: 'rpc.frame',
            bridgeRequestId: payload.bridgeRequestId,
            connectionId: payload.connectionId,
            message,
          }).catch((error) => log.warn({ err: error }, 'Realtime RPC frame send failed'))
        },
      })
    } catch (error) {
      await this.send({
        type: 'rpc.frame',
        bridgeRequestId: payload.bridgeRequestId,
        connectionId: payload.connectionId,
        message: {
          type: 'error',
          requestId: payload.message.requestId,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    } finally {
      await this.send({
        type: 'rpc.complete',
        bridgeRequestId: payload.bridgeRequestId,
        connectionId: payload.connectionId,
        subscriptions: [...subscriptions],
      })
    }
  }

  private spawnChild(): void {
    if (this.closing) return
    const entry = resolveRealtimeEntryPath(import.meta.url)
    const child = fork(entry, [], {
      env: {
        ...process.env,
        AI_IDE_REALTIME_IPC_ENDPOINT: this.endpoint,
        AI_IDE_REALTIME_INTERNAL_TOKEN: this.internalToken,
        AI_IDE_REALTIME_HOST: this.options.host,
        AI_IDE_REALTIME_PORT: String(this.options.port),
        AI_IDE_REALTIME_LEGACY_RPC: this.options.legacyRpcEnabled === false ? 'disabled' : 'enabled',
        AI_IDE_REALTIME_MAX_QUEUE_MESSAGES: String(this.options.maxQueueMessages ?? 500),
        AI_IDE_REALTIME_MAX_QUEUE_BYTES: String(this.options.maxQueueBytes ?? 2 * 1024 * 1024),
        AI_IDE_REALTIME_MAX_BUFFERED_BYTES: String(this.options.maxBufferedBytes ?? 2 * 1024 * 1024),
        AI_IDE_REALTIME_MAX_FRAME_BYTES: String(this.maxFrameBytes),
        AI_IDE_REALTIME_FLUSH_INTERVAL_MS: String(this.options.flushIntervalMs ?? 10),
        AI_IDE_RUNTIME_STREAM_ENDPOINT: this.runtimeStreamEndpoint,
        AI_IDE_RUNTIME_STREAM_TOKEN: this.runtimeStreamToken,
      },
      execArgv: entry.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    this.child = child
    child.once('error', (error) => log.error({ err: error }, 'Realtime process error'))
    child.once('exit', (code, signal) => this.handleExit(child, code, signal))
  }

  private handleExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return
    this.child = undefined
    for (const resolve of this.exitWaiters) resolve()
    this.exitWaiters.clear()
    if (this.closing) return
    log.warn({ code, signal }, 'Realtime process exited; scheduling restart')
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      this.spawnChild()
    }, this.options.restartDelayMs ?? 250)
  }

  private send(payload: RealtimeIpcPayload): Promise<void> {
    if (!this.channel) return Promise.reject(new Error('Realtime IPC is unavailable'))
    return this.channel.send(toEnvelope(payload))
  }

  private notifyEndpointChange(): void {
    const endpointUrl = this.endpointUrl
    for (const listener of this.endpointListeners) {
      try {
        listener(endpointUrl)
      } catch (error) {
        log.warn({ err: error }, 'Realtime endpoint listener failed')
      }
    }
  }

  private waitUntilReady(timeoutMs: number): Promise<void> {
    if (this.currentGeneration > 0) return Promise.resolve()
    return withTimeout(new Promise<void>((resolve) => this.readyWaiters.add(resolve)), timeoutMs, 'Realtime readiness timed out')
  }

  private waitForExit(): Promise<void> {
    if (!this.child) return Promise.resolve()
    return new Promise<void>((resolve) => this.exitWaiters.add(resolve))
  }
}

function toEnvelope(payload: RealtimeIpcPayload): IpcEnvelope {
  return {
    version: '1',
    kind: payload.type,
    timestamp: Date.now(),
    payload: payload as unknown as Record<string, unknown>,
  }
}

function createIpcEndpoint(): string {
  const suffix = `${process.pid}-${randomUUID()}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\ai-ide-realtime-${suffix}`
    : join(tmpdir(), `ai-ide-realtime-${suffix}.sock`)
}

function createRuntimeStreamEndpoint(): string {
  const suffix = `${process.pid}-${randomUUID()}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\ai-ide-runtime-stream-${suffix}`
    : join(tmpdir(), `ai-ide-runtime-stream-${suffix}.sock`)
}

function removeIpcEndpoint(endpoint: string): void {
  if (process.platform !== 'win32' && existsSync(endpoint)) rmSync(endpoint, { force: true })
}

function listen(server: Server, endpoint: string): Promise<void> {
  removeIpcEndpoint(endpoint)
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const onListening = (): void => { cleanup(); resolve() }
    const cleanup = (): void => {
      server.off('error', onError)
      server.off('listening', onListening)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(endpoint)
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function publicHost(host: string): string {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
}
