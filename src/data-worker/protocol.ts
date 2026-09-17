/**
 * 查询优先级(2026-09-16 卡顿 P0-3)。
 * - interactive:轻交互查询,必须快(tasks、sessions.list、widget、sessions.messages/events)
 * - heavy:重查询,耗时可达 10s+(sessions.recovery),排在轻查询之后,避免挡住别人
 * - background:诊断类
 * 注意:优先级只决定**出队顺序**,不能抢占正在执行的查询(better-sqlite3 同步不可中断)。
 */
export type QueryPriority = 'interactive' | 'heavy' | 'background'
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
