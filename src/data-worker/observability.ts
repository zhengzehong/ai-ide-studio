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

export interface DataWorkerLatencyComponents {
  queueWaitMs: number
  executionMs: number
  deliveryLagMs: number
}

/** 三项耗时各自归属的成因:queue=worker 队列等待、execution=事务执行、delivery=API 事件循环投递滞后。 */
export function dataWorkerLatencyComponents(metrics: DataWorkerLatencyMetrics): DataWorkerLatencyComponents {
  return {
    queueWaitMs: metrics.queueWaitMs,
    executionMs: metrics.executionMs,
    deliveryLagMs: metrics.deliveryLagMs ?? 0,
  }
}

/**
 * 按"三项耗时里最大的那一项"归属成因。
 * 修复背景:旧实现按 delivery → execution → queue 的固定顺序判定,会把
 * queueWaitMs=9844 / executionMs=352 / deliveryLagMs=451 这种"队列真凶"误标成 api_delivery。
 * 三项全部低于阈值时退回 total 判定(与旧行为一致)。
 */
export function classifyDataWorkerLatency(
  metrics: DataWorkerLatencyMetrics,
  slowRequestMs: number,
): DataWorkerLatencyCause {
  const components = dataWorkerLatencyComponents(metrics)
  const dominant = (Object.entries(components) as Array<[keyof DataWorkerLatencyComponents, number]>)
    .reduce((worst, current) => (current[1] > worst[1] ? current : worst))
  if (dominant[1] >= slowRequestMs) {
    switch (dominant[0]) {
      case 'deliveryLagMs':
        return 'api_delivery'
      case 'queueWaitMs':
        return 'worker_queue'
      default:
        return 'worker_execution'
    }
  }
  return isSlowWorkerRequest(metrics, slowRequestMs) ? 'worker_execution' : 'within_budget'
}
