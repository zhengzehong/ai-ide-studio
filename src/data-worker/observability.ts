import type { WorkerMetrics } from './protocol.js'

export const DEFAULT_DATA_WORKER_SLOW_MS = 100

export type DataWorkerLatencyCause =
  | 'within_budget'
  | 'api_delivery'
  | 'worker_execution'
  | 'worker_queue'

interface DataWorkerLatencyMetrics {
  queueWaitMs: number
  executionMs: number
  totalMs: number
  clientObservedMs?: number
  deliveryLagMs?: number
}

export function parseDataWorkerSlowMs(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DATA_WORKER_SLOW_MS
}

export function isSlowWorkerRequest(
  metrics: Pick<WorkerMetrics, 'totalMs'> & { clientObservedMs?: number },
  slowRequestMs: number,
): boolean {
  return Math.max(metrics.totalMs, metrics.clientObservedMs ?? 0) >= slowRequestMs
}

export function classifyDataWorkerLatency(
  metrics: DataWorkerLatencyMetrics,
  slowRequestMs: number,
): DataWorkerLatencyCause {
  if ((metrics.deliveryLagMs ?? 0) >= slowRequestMs) return 'api_delivery'
  if (metrics.executionMs >= slowRequestMs) return 'worker_execution'
  if (metrics.queueWaitMs >= slowRequestMs) return 'worker_queue'
  return isSlowWorkerRequest(metrics, slowRequestMs) ? 'worker_execution' : 'within_budget'
}
