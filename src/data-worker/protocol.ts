export type QueryPriority = 'interactive' | 'background'
export type WritePriority = 'critical' | 'interactive' | 'background'
export type WorkerPriority = QueryPriority | WritePriority

export type WorkerErrorCode =
  | 'BAD_REQUEST'
  | 'DEADLINE_EXCEEDED'
  | 'WORKER_UNAVAILABLE'
  | 'SQLITE_ERROR'
  | 'SQLITE_BUSY'
  | 'SQLITE_BUSY_SNAPSHOT'
  | 'SQLITE_LOCKED'
  | 'SQLITE_LOCKED_SHAREDCACHE'
  | 'ORDER_CONFLICT'
  | 'INTERNAL'

export interface WorkerMetrics {
  queueDepth: number
  queueWaitMs: number
  executionMs: number
  totalMs: number
  payloadBytes: number
}

export interface WorkerErrorPayload {
  code: WorkerErrorCode
  message: string
  details?: Record<string, unknown>
}

export interface WorkerRequest<TPayload = unknown> {
  kind: 'request'
  requestId: string
  operation: string
  priority: WorkerPriority
  enqueuedAt: number
  deadlineAt?: number
  payload: TPayload
  payloadBytes: number
}

export type WorkerResponse<TResult = unknown> =
  | {
      kind: 'result'
      requestId: string
      result: TResult
      metrics: WorkerMetrics
    }
  | {
      kind: 'error'
      requestId: string
      error: WorkerErrorPayload
      metrics: WorkerMetrics
    }

export interface WorkerReadyMessage {
  kind: 'ready'
  worker: 'query' | 'writer'
}

export interface WorkerControlRequest {
  kind: 'control'
  operation: 'drain' | 'close'
  requestId: string
}

export type DataWorkerInboundMessage = WorkerRequest | WorkerControlRequest
export type DataWorkerOutboundMessage = WorkerResponse | WorkerReadyMessage

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (record.kind === 'result' || record.kind === 'error') && typeof record.requestId === 'string'
}
