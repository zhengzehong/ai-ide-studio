import type { WorkerMetrics } from './protocol.js'

export const DEFAULT_DATA_WORKER_SLOW_MS = 100

export function parseDataWorkerSlowMs(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DATA_WORKER_SLOW_MS
}

export function isSlowWorkerRequest(
  metrics: Pick<WorkerMetrics, 'totalMs'>,
  slowRequestMs: number,
): boolean {
  return metrics.totalMs >= slowRequestMs
}
