import { createConnection, type Socket } from 'node:net'
import { FramedSocket } from '../ipc/framed-socket.js'
import type { IpcEnvelope } from '../ipc/protobuf-envelope.js'
import { createChildLogger } from '../shared/logger.js'
import { shouldHandleInteractiveSignal } from '../shared/process-signal-ownership.js'
import { isRealtimeIpcPayload, type RealtimeIpcPayload } from './protocol.js'
import { startRealtimeService, type RealtimeServiceHandle } from './service.js'
import { startRuntimeStreamIngress, type RuntimeStreamIngress } from './runtime-stream-ingress.js'

const log = createChildLogger('realtime-service')
const config = readConfig()
let transport: FramedSocket | undefined
let service: RealtimeServiceHandle | undefined
let runtimeIngress: RuntimeStreamIngress | undefined
let stopping = false

async function main(): Promise<void> {
  const socket = await connect(config.ipcEndpoint)
  transport = new FramedSocket(socket, { maxFrameBytes: config.maxFrameBytes })
  transport.onMessage((message) => {
    void handleEnvelope(message).catch((error) => {
      if (stopping) return
      log.error({ err: error }, 'Realtime IPC message handling failed')
      void shutdown(1)
    })
  })
  transport.onError((error) => log.error({ err: error }, 'Realtime IPC failed'))
  socket.once('close', () => {
    if (!stopping) void shutdown(1)
  })
  await send({ type: 'hello', token: config.internalToken })
}

async function handleEnvelope(envelope: IpcEnvelope): Promise<void> {
  if (!isRealtimeIpcPayload(envelope.payload)) return
  const payload = envelope.payload
  if (payload.type === 'hello.ack') {
    service = await startRealtimeService({
      host: config.host,
      port: config.port,
      legacyRpcEnabled: config.legacyRpcEnabled,
      maxQueueMessages: config.maxQueueMessages,
      maxQueueBytes: config.maxQueueBytes,
      maxBufferedBytes: config.maxBufferedBytes,
      flushIntervalMs: config.flushIntervalMs,
      sendIpc: send,
    })
    runtimeIngress = await startRuntimeStreamIngress({
      endpoint: config.runtimeStreamEndpoint,
      token: config.runtimeStreamToken,
      maxFrameBytes: config.maxFrameBytes,
      onMessage: (message) => service?.handleRuntimeMessage(message),
    })
    await send({ type: 'ready', port: service.port })
    log.info({ host: config.host, port: service.port }, 'Realtime service started')
    return
  }
  if (payload.type === 'control') {
    if (payload.operation === 'drain') {
      await send({ type: 'control.ack', operation: 'drain' })
      return
    }
    await send({ type: 'control.ack', operation: 'stop' })
    await shutdown(0)
    return
  }
  await service?.handleIpc(payload)
}

async function send(payload: RealtimeIpcPayload): Promise<void> {
  if (!transport) throw new Error('Realtime IPC transport is not connected')
  await transport.send(toEnvelope(payload))
}

async function shutdown(exitCode: number): Promise<void> {
  if (stopping) return
  stopping = true
  await service?.close().catch((error) => log.warn({ err: error }, 'Realtime service close failed'))
  await runtimeIngress?.close().catch((error) => log.warn({ err: error }, 'Runtime stream close failed'))
  await transport?.close().catch(() => undefined)
  process.exit(exitCode)
}

function toEnvelope(payload: RealtimeIpcPayload): IpcEnvelope {
  return {
    version: '1',
    kind: payload.type,
    timestamp: Date.now(),
    payload: payload as unknown as Record<string, unknown>,
  }
}

function connect(endpoint: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    const onConnect = (): void => { cleanup(); resolve(socket) }
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const cleanup = (): void => {
      socket.off('connect', onConnect)
      socket.off('error', onError)
    }
    socket.once('connect', onConnect)
    socket.once('error', onError)
  })
}

function readConfig(): {
  ipcEndpoint: string
  internalToken: string
  host: string
  port: number
  legacyRpcEnabled: boolean
  maxQueueMessages: number
  maxQueueBytes: number
  maxBufferedBytes: number
  maxFrameBytes: number
  flushIntervalMs: number
  runtimeStreamEndpoint: string
  runtimeStreamToken: string
} {
  return {
    ipcEndpoint: requiredEnv('AI_IDE_REALTIME_IPC_ENDPOINT'),
    internalToken: requiredEnv('AI_IDE_REALTIME_INTERNAL_TOKEN'),
    host: process.env.AI_IDE_REALTIME_HOST || '127.0.0.1',
    port: positiveInteger(process.env.AI_IDE_REALTIME_PORT, 0, true),
    legacyRpcEnabled: process.env.AI_IDE_REALTIME_LEGACY_RPC !== 'disabled',
    maxQueueMessages: positiveInteger(process.env.AI_IDE_REALTIME_MAX_QUEUE_MESSAGES, 500),
    maxQueueBytes: positiveInteger(process.env.AI_IDE_REALTIME_MAX_QUEUE_BYTES, 2 * 1024 * 1024),
    maxBufferedBytes: positiveInteger(process.env.AI_IDE_REALTIME_MAX_BUFFERED_BYTES, 2 * 1024 * 1024),
    maxFrameBytes: positiveInteger(process.env.AI_IDE_REALTIME_MAX_FRAME_BYTES, 16 * 1024 * 1024),
    flushIntervalMs: positiveInteger(process.env.AI_IDE_REALTIME_FLUSH_INTERVAL_MS, 10),
    runtimeStreamEndpoint: requiredEnv('AI_IDE_RUNTIME_STREAM_ENDPOINT'),
    runtimeStreamToken: requiredEnv('AI_IDE_RUNTIME_STREAM_TOKEN'),
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(value: string | undefined, fallback: number, allowZero = false): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0) ? parsed : fallback
}

process.on('SIGINT', () => {
  if (shouldHandleInteractiveSignal(process.connected)) void shutdown(0)
})
process.once('SIGTERM', () => { void shutdown(0) })

main().catch((error) => {
  log.fatal({ err: error }, 'Realtime service failed to start')
  process.exit(1)
})
