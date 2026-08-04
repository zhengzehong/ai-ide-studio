import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { FramedSocket } from '../../ipc/framed-socket.js'
import type { IpcEnvelope } from '../../ipc/protobuf-envelope.js'
import { createChildLogger } from '../../shared/logger.js'
import { shouldHandleInteractiveSignal } from '../../shared/process-signal-ownership.js'
import { isRuntimeControlPayload, type RuntimeControlPayload, type RuntimeDoneEvent } from './protocol.js'
import { runRuntimeControlRequest } from './runtime-control-request.js'
import { RuntimeService } from './service.js'

const log = createChildLogger('runtime-service')
const config = readConfig()
let transport: FramedSocket | undefined
let service: RuntimeService | undefined
let stopping = false
const doneAcks = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()

async function main(): Promise<void> {
  const socket = await connect(config.ipcEndpoint)
  transport = new FramedSocket(socket, { maxFrameBytes: config.maxFrameBytes })
  transport.onMessage((envelope) => {
    void handleEnvelope(envelope).catch((error) => {
      if (!stopping) log.error({ err: error }, 'Runtime control message failed')
    })
  })
  transport.onError((error) => log.error({ err: error }, 'Runtime control IPC failed'))
  socket.once('close', () => { if (!stopping) void shutdown(1) })
  await send({ type: 'hello', token: config.internalToken })
}

async function handleEnvelope(envelope: IpcEnvelope): Promise<void> {
  if (!isRuntimeControlPayload(envelope.payload)) return
  const payload = envelope.payload
  if (payload.type === 'hello.ack') {
    service = new RuntimeService({
      streamEndpoint: config.streamEndpoint,
      streamToken: config.streamToken,
      maxFrameBytes: config.maxFrameBytes,
      sendPersistence: (event) => sendUnlessStopping({ type: 'persistence', event }),
      sendDone,
      sendAgentStatus: (event) => sendUnlessStopping({ type: 'agent-status', event }),
      onBackgroundError: (error, channel) => {
        log.fatal({ err: error, channel }, 'Runtime background pipeline failed; restarting process')
        void shutdown(1)
      },
      idleSweepIntervalMs: config.idleSweepIntervalMs,
      sessionIdleMs: config.sessionIdleMs,
      agentIdleMs: config.agentIdleMs,
    })
    await service.start()
    await send({ type: 'ready' })
    return
  }
  if (payload.type === 'request') {
    await runRuntimeControlRequest({
      execute: () => service?.execute(payload.command) ?? Promise.resolve(undefined),
      reply: (response) => send({ type: 'result', requestId: payload.requestId, ...response }),
      isStopping: () => stopping,
    })
    return
  }
  if (payload.type === 'done.ack') {
    const pending = doneAcks.get(payload.requestId)
    if (!pending) return
    doneAcks.delete(payload.requestId)
    if (payload.error) pending.reject(new Error(payload.error))
    else pending.resolve()
    return
  }
  if (payload.type === 'control') await shutdown(0)
}

async function sendDone(event: RuntimeDoneEvent): Promise<void> {
  if (stopping) return
  const requestId = randomUUID()
  const ack = new Promise<void>((resolve, reject) => doneAcks.set(requestId, { resolve, reject }))
  await send({ type: 'done', requestId, event })
  await ack
}

async function sendUnlessStopping(payload: RuntimeControlPayload): Promise<void> {
  if (stopping) return
  try {
    await send(payload)
  } catch (error) {
    if (!stopping) throw error
  }
}

function send(payload: RuntimeControlPayload): Promise<void> {
  if (!transport) return Promise.reject(new Error('Runtime control transport is unavailable'))
  return transport.send({
    version: '1',
    kind: payload.type,
    timestamp: Date.now(),
    payload: payload as unknown as Record<string, unknown>,
  })
}

async function shutdown(code: number): Promise<void> {
  if (stopping) return
  stopping = true
  const shutdownError = new Error('Runtime service is shutting down')
  for (const pending of doneAcks.values()) pending.reject(shutdownError)
  doneAcks.clear()
  await service?.close().catch((error) => log.warn({ err: error }, 'Runtime service close failed'))
  await transport?.close().catch(() => undefined)
  process.exit(code)
}

function connect(endpoint: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function readConfig(): {
  ipcEndpoint: string
  internalToken: string
  streamEndpoint: string
  streamToken: string
  maxFrameBytes: number
  idleSweepIntervalMs: number
  sessionIdleMs: number
  agentIdleMs: number
} {
  return {
    ipcEndpoint: requiredEnv('AI_IDE_RUNTIME_IPC_ENDPOINT'),
    internalToken: requiredEnv('AI_IDE_RUNTIME_INTERNAL_TOKEN'),
    streamEndpoint: requiredEnv('AI_IDE_RUNTIME_STREAM_ENDPOINT'),
    streamToken: requiredEnv('AI_IDE_RUNTIME_STREAM_TOKEN'),
    maxFrameBytes: positiveInteger(process.env.AI_IDE_RUNTIME_MAX_FRAME_BYTES, 16 * 1024 * 1024),
    idleSweepIntervalMs: positiveInteger(process.env.AI_IDE_RUNTIME_IDLE_SWEEP_MS, 5 * 60 * 1000),
    sessionIdleMs: positiveInteger(process.env.AI_IDE_RUNTIME_SESSION_IDLE_MS, 30 * 60 * 1000),
    agentIdleMs: positiveInteger(process.env.AI_IDE_RUNTIME_AGENT_IDLE_MS, 60 * 60 * 1000),
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

process.on('SIGINT', () => {
  if (shouldHandleInteractiveSignal(process.connected)) void shutdown(0)
})
process.once('SIGTERM', () => { void shutdown(0) })

main().catch((error) => {
  log.fatal({ err: error }, 'Runtime service failed to start')
  process.exit(1)
})
