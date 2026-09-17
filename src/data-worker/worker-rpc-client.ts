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
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('data-worker-rpc')

export interface WorkerRpcClientOptions {
  defaultTimeoutMs?: number
  onLateResponse?: (response: LateWorkerResponse) => void
}

export interface WorkerRpcRequestOptions {
  priority: WorkerPriority
  deadlineMs?: number
  timeoutMs?: number
}

export interface WorkerCallResult<TResult> {
  result: TResult
  metrics: WorkerClientMetrics
}

interface PendingRequest {
  resolve: (value: WorkerCallResult<unknown>) => void
  reject: (reason: WorkerRequestError) => void
  timer: NodeJS.Timeout
  operation: string
  enqueuedAt: number
}

interface TimedOutRequest {
  operation: string
  enqueuedAt: number
  timedOutAt: number
}

export interface WorkerClientMetrics extends WorkerMetrics {
  workerTotalMs: number
  clientObservedMs: number
  deliveryLagMs: number
}

export interface LateWorkerResponse extends WorkerClientMetrics {
  requestId: string
  operation: string
  responseKind: 'result' | 'error'
  pendingCountAtResponse: number
  timedOutAfterMs: number
  workerErrorCode?: WorkerErrorCode
}

const DEFAULT_TIMEOUT_MS = 10_000
const LATE_RESPONSE_TTL_MS = 60_000
const MAX_LATE_RESPONSE_TOMBSTONES = 1_000

export class WorkerRequestError extends Error {
  readonly code: WorkerErrorCode
  readonly details?: Record<string, unknown>
  readonly metrics?: WorkerClientMetrics
  readonly clientObservedMs?: number
  readonly requestId?: string
  readonly operation?: string

  constructor(
    code: WorkerErrorCode,
    message: string,
    details?: Record<string, unknown>,
    metrics?: WorkerClientMetrics,
    clientObservedMs?: number,
    requestId?: string,
    operation?: string,
  ) {
    super(message)
    this.name = 'WorkerRequestError'
    this.code = code
    this.details = details
    this.metrics = metrics
    this.clientObservedMs = clientObservedMs
    this.requestId = requestId
    this.operation = operation
  }
}

export class WorkerRpcClient {
  private readonly worker: Worker
  private readonly defaultTimeoutMs: number
  private readonly onLateResponse?: (response: LateWorkerResponse) => void
  private readonly pending = new Map<string, PendingRequest>()
  private readonly timedOut = new Map<string, TimedOutRequest>()
  private readonly drainWaiters = new Set<() => void>()
  private state: 'open' | 'unavailable' | 'closed' = 'open'
  private closePromise?: Promise<void>

  constructor(worker: Worker, options: WorkerRpcClientOptions = {}) {
    this.worker = worker
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.onLateResponse = options.onLateResponse
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
        this.timeoutPending(requestId)
      }, timeoutMs)
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as WorkerCallResult<TResult>),
        reject,
        timer,
        operation,
        enqueuedAt,
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
    this.timedOut.clear()
    this.removeListeners()
    this.closePromise = this.worker.terminate().then(() => undefined, () => undefined)
    return this.closePromise
  }

  private readonly handleMessage = (message: unknown): void => {
    if (!isWorkerResponse(message)) return
    const pending = this.pending.get(message.requestId)
    if (!pending) {
      this.reportLateResponse(message)
      return
    }
    this.pending.delete(message.requestId)
    clearTimeout(pending.timer)
    const metrics = clientMetrics(message.metrics, pending.enqueuedAt)
    if (message.kind === 'result') {
      pending.resolve({ result: message.result, metrics })
    } else {
      pending.reject(new WorkerRequestError(
        message.error.code,
        message.error.message,
        message.error.details,
        metrics,
        metrics.clientObservedMs,
        message.requestId,
        pending.operation,
      ))
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

  private timeoutPending(requestId: string): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    const timedOutAt = Date.now()
    this.pruneTimedOut(timedOutAt)
    this.timedOut.set(requestId, {
      operation: pending.operation,
      enqueuedAt: pending.enqueuedAt,
      timedOutAt,
    })
    this.pruneTimedOut(timedOutAt)
    this.rejectPending(
      requestId,
      new WorkerRequestError(
        'DEADLINE_EXCEEDED',
        `Worker request timed out: ${pending.operation}`,
        undefined,
        undefined,
        Math.max(0, timedOutAt - pending.enqueuedAt),
        requestId,
        pending.operation,
      ),
    )
  }

  private reportLateResponse(message: WorkerResponse): void {
    const timedOut = this.timedOut.get(message.requestId)
    if (!timedOut) return
    this.timedOut.delete(message.requestId)
    const metrics = clientMetrics(message.metrics, timedOut.enqueuedAt)
    const response: LateWorkerResponse = {
      ...metrics,
      requestId: message.requestId,
      operation: timedOut.operation,
      responseKind: message.kind,
      pendingCountAtResponse: this.pending.size,
      timedOutAfterMs: Math.max(0, timedOut.timedOutAt - timedOut.enqueuedAt),
      ...(message.kind === 'error' ? { workerErrorCode: message.error.code } : {}),
    }
    // worker 按 deadline 主动跳过过期请求时回的 DEADLINE_EXCEEDED 属于"预期内的兜底",
    // 降为 debug 避免刷屏;其余迟到响应(真的异常/超时)保持 warn。
    const skippedByDeadline = message.kind === 'error' && message.error.code === 'DEADLINE_EXCEEDED'
    if (skippedByDeadline) {
      log.debug(response, 'query worker skipped a request whose deadline had passed')
    } else {
      log.warn(response, 'late data worker response received after client timeout')
    }
    this.onLateResponse?.(response)
  }
  private pruneTimedOut(now: number): void {
    for (const [requestId, request] of this.timedOut) {
      if (now - request.timedOutAt <= LATE_RESPONSE_TTL_MS) break
      this.timedOut.delete(requestId)
    }
    while (this.timedOut.size >= MAX_LATE_RESPONSE_TOMBSTONES) {
      const oldest = this.timedOut.keys().next().value as string | undefined
      if (!oldest) break
      this.timedOut.delete(oldest)
    }
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

function clientMetrics(metrics: WorkerMetrics, enqueuedAt: number): WorkerClientMetrics {
  const clientObservedMs = Math.max(0, Date.now() - enqueuedAt)
  return {
    ...metrics,
    workerTotalMs: metrics.totalMs,
    clientObservedMs,
    deliveryLagMs: Math.max(0, clientObservedMs - metrics.totalMs),
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
