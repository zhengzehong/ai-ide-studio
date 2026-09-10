import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import type { Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcEnvelope } from '../../ipc/protobuf-envelope.js'
import type { RuntimeCancelResult, RuntimePort } from '../../ports/runtime-port.js'
import type { RuntimeControlPayload, RuntimeCommand, RuntimeAgentStatusEvent, RuntimeDoneEvent, RuntimePersistenceUpdate } from '../service/protocol.js'

export interface CreateProcessRuntimePortOptions {
  realtimeStreamEndpoint: string
  realtimeStreamToken: string
  onPersistenceUpdate: (event: RuntimePersistenceUpdate) => Promise<void>
  onDone: (event: RuntimeDoneEvent) => Promise<void>
  onAgentStatus?: (event: RuntimeAgentStatusEvent) => void | Promise<void>
  readyTimeoutMs?: number
  requestTimeoutMs?: number
  forkTimeoutMs?: number
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

// Prompt is unbounded; native fork operations retain their separate five-minute budget.
export function resolveRuntimeRequestTimeoutMs(
  operation: RuntimeCommand['operation'],
  options: { forkTimeoutMs?: number; requestTimeoutMs?: number },
): number | undefined {
  if (operation === 'prompt') return undefined
  if (operation === 'fork') return options.forkTimeoutMs ?? 300_000
  return options.requestTimeoutMs ?? 30_000
}

export interface RuntimePendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer?: NodeJS.Timeout
}

export function resolvePlatformToolBaseUrl(): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim()
  return configured || `http://127.0.0.1:${process.env.PORT ?? '18800'}`
}

export function asRuntimeCancelResult(value: unknown): RuntimeCancelResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Runtime cancel response is invalid')
  }
  const record = value as Record<string, unknown>
  if (record.status === 'not-found' || record.status === 'not-active') return { status: record.status }
  if (record.status !== 'requested'
    || (record.escalation !== 'cancel' && record.escalation !== 'session-close' && record.escalation !== 'agent-restart')
    || typeof record.messageId !== 'string') {
    throw new Error('Runtime cancel response is invalid')
  }
  return {
    status: record.status,
    escalation: record.escalation,
    messageId: record.messageId,
    ...(typeof record.turnId === 'string' ? { turnId: record.turnId } : {}),
  }
}

export function toRuntimeEnvelope(payload: RuntimeControlPayload): IpcEnvelope {
  return { version: '1', kind: payload.type, timestamp: Date.now(), payload: payload as unknown as Record<string, unknown> }
}

export function createRuntimeIpcEndpoint(): string {
  const suffix = `${process.pid}-${randomUUID()}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\ai-ide-runtime-${suffix}`
    : join(tmpdir(), `ai-ide-runtime-${suffix}.sock`)
}

export function removeRuntimeEndpoint(endpoint: string): void {
  if (process.platform !== 'win32' && existsSync(endpoint)) rmSync(endpoint, { force: true })
}

export function listenOnRuntimeEndpoint(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, resolve)
  })
}

export function closeRuntimeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

export function withRuntimeTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([promise, delay(timeoutMs).then(() => { throw new Error(message) })])
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function runtimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
