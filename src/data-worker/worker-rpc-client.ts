import { randomUUID } from 'node:crypto'
import type { Worker } from 'node:worker_threads'
import {
  isWorkerResponse,
  type WorkerErrorCode,
  type WorkerMetrics,
  type WorkerPriority,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol.js'

export interface WorkerRpcClientOptions {
  defaultTimeoutMs?: number
}

export interface WorkerRpcRequestOptions {
  priority: WorkerPriority
  deadlineMs?: number
  timeoutMs?: number
}

export interface WorkerCallResult<TResult> {
  result: TResult
  metrics: WorkerMetrics
}

interface PendingRequest {
  resolve: (value: WorkerCallResult<unknown>) => void
  reject: (reason: WorkerRequestError) => void
  timer: NodeJS.Timeout
}

const DEFAULT_TIMEOUT_MS = 10_000

export class WorkerRequestError extends Error {
  readonly code: WorkerErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: WorkerErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'WorkerRequestError'
    this.code = code
    this.details = details
  }
}

export class WorkerRpcClient {
  private readonly worker: Worker
  private readonly defaultTimeoutMs: number
  private readonly pending = new Map<string, PendingRequest>()
  private readonly drainWaiters = new Set<() => void>()
  private state: 'open' | 'unavailable' | 'closed' = 'open'
  private closePromise?: Promise<void>

  constructor(worker: Worker, options: WorkerRpcClientOptions = {}) {
    this.worker = worker
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.worker.on('message', this.handleMessage)
    this.worker.on('error', this.handleWorkerError)
    this.worker.on('exit', this.handleWorkerExit)
  }

  get pendingCount(): number {
    return this.pending.size
  }

  async request<TResult>(
    operation: string,
    payload: unknown,
    options: WorkerRpcRequestOptions,
  ): Promise<WorkerCallResult<TResult>> {
    if (this.state !== 'open') {
      throw new WorkerRequestError('WORKER_UNAVAILABLE', 'Data worker is not available')
    }

    const requestId = randomUUID()
    const enqueuedAt = Date.now()
    const deadlineAt = options.deadlineMs == null ? undefined : enqueuedAt + options.deadlineMs
    const payloadBytes = serializedBytes(payload)
    const request: WorkerRequest = {
      kind: 'request',
      requestId,
      operation,
      priority: options.priority,
      enqueuedAt,
      deadlineAt,
      payload,
      payloadBytes,
    }
    const timeoutMs = Math.max(
      1,
      Math.min(options.timeoutMs ?? this.defaultTimeoutMs, options.deadlineMs ?? Number.MAX_SAFE_INTEGER),
    )

    return new Promise<WorkerCallResult<TResult>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending(
          requestId,
          new WorkerRequestError('DEADLINE_EXCEEDED', `Worker request timed out: ${operation}`),
        )
      }, timeoutMs)
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as WorkerCallResult<TResult>),
        reject,
        timer,
      })
      try {
        this.worker.postMessage(request)
      } catch (error) {
        this.rejectPending(
          requestId,
          new WorkerRequestError('WORKER_UNAVAILABLE', errorMessage(error)),
        )
      }
    })
  }

  async drain(): Promise<void> {
    if (this.pending.size === 0) return
    await new Promise<void>((resolve) => this.drainWaiters.add(resolve))
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.state = 'closed'
    this.failAll(new WorkerRequestError('WORKER_UNAVAILABLE', 'Data worker client closed'))
    this.removeListeners()
    this.closePromise = this.worker.terminate().then(() => undefined, () => undefined)
    return this.closePromise
  }

  private readonly handleMessage = (message: unknown): void => {
    if (!isWorkerResponse(message)) return
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    this.pending.delete(message.requestId)
    clearTimeout(pending.timer)
    if (message.kind === 'result') {
      pending.resolve({ result: message.result, metrics: message.metrics })
    } else {
      pending.reject(new WorkerRequestError(message.error.code, message.error.message, message.error.details))
    }
    this.resolveDrainWaitersIfIdle()
  }

  private readonly handleWorkerError = (error: Error): void => {
    if (this.state === 'closed') return
    this.state = 'unavailable'
    this.failAll(new WorkerRequestError('WORKER_UNAVAILABLE', error.message))
  }

  private readonly handleWorkerExit = (code: number): void => {
    if (this.state === 'closed') return
    this.state = 'unavailable'
    this.failAll(new WorkerRequestError('WORKER_UNAVAILABLE', `Data worker exited with code ${code}`))
  }

  private rejectPending(requestId: string, error: WorkerRequestError): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.reject(error)
    this.resolveDrainWaitersIfIdle()
  }

  private failAll(error: WorkerRequestError): void {
    for (const requestId of [...this.pending.keys()]) {
      this.rejectPending(requestId, error)
    }
  }

  private resolveDrainWaitersIfIdle(): void {
    if (this.pending.size > 0) return
    for (const resolve of this.drainWaiters) resolve()
    this.drainWaiters.clear()
  }

  private removeListeners(): void {
    this.worker.off('message', this.handleMessage)
    this.worker.off('error', this.handleWorkerError)
    this.worker.off('exit', this.handleWorkerExit)
  }
}

function serializedBytes(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload) ?? 'null', 'utf8')
  } catch (error) {
    throw new WorkerRequestError('BAD_REQUEST', `Worker payload is not serializable: ${errorMessage(error)}`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
