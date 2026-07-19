import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { createChildLogger } from './logger.js'

export interface EventLoopHistogram {
  enable(): void
  disable(): void
  reset(): void
  percentile(value: number): number
  readonly max: number
}

interface EventLoopUtilization {
  idle: number
  active: number
  utilization: number
}

interface MemoryUsageSnapshot {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

interface EventLoopMonitorLogger {
  debug(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
}

export interface EventLoopMonitorDependencies {
  createHistogram: () => EventLoopHistogram
  eventLoopUtilization: () => EventLoopUtilization
  memoryUsage: () => MemoryUsageSnapshot
  setInterval: (callback: () => void, intervalMs: number) => unknown
  clearInterval: (timer: unknown) => void
  logger: EventLoopMonitorLogger
}

export interface EventLoopMonitorOptions {
  service: string
  intervalMs?: number
  warnThresholdMs?: number
  getContext?: () => Record<string, number>
}

export interface EventLoopSample extends Record<string, unknown> {
  service: string
  eventLoopP50Ms: number
  eventLoopP95Ms: number
  eventLoopP99Ms: number
  eventLoopMaxMs: number
  eventLoopUtilization: number
  rssBytes: number
  heapUsedBytes: number
  heapTotalBytes: number
  externalBytes: number
  arrayBuffersBytes: number
}

export interface EventLoopMonitor {
  start(): void
  sample(): EventLoopSample
  stop(): void
}

export const DEFAULT_EVENT_LOOP_MONITOR_INTERVAL_MS = 30_000
export const DEFAULT_EVENT_LOOP_WARN_THRESHOLD_MS = 50

export function eventLoopMonitorOptions(
  service: string,
  getContext?: () => Record<string, number>,
): EventLoopMonitorOptions {
  return {
    service,
    intervalMs: positiveNumber(process.env.EVENT_LOOP_MONITOR_INTERVAL_MS, DEFAULT_EVENT_LOOP_MONITOR_INTERVAL_MS),
    warnThresholdMs: positiveNumber(process.env.EVENT_LOOP_WARN_THRESHOLD_MS, DEFAULT_EVENT_LOOP_WARN_THRESHOLD_MS),
    getContext,
  }
}

export function createEventLoopMonitor(
  options: EventLoopMonitorOptions,
  dependencies: EventLoopMonitorDependencies = defaultDependencies(options.service),
): EventLoopMonitor {
  const histogram = dependencies.createHistogram()
  let baseline: EventLoopUtilization | undefined
  let timer: unknown

  const sample = (): EventLoopSample => {
    const current = dependencies.eventLoopUtilization()
    const utilization = utilizationDelta(baseline, current)
    baseline = current
    const memory = dependencies.memoryUsage()
    const result: EventLoopSample = {
      service: options.service,
      eventLoopP50Ms: nanosecondsToMilliseconds(histogram.percentile(50)),
      eventLoopP95Ms: nanosecondsToMilliseconds(histogram.percentile(95)),
      eventLoopP99Ms: nanosecondsToMilliseconds(histogram.percentile(99)),
      eventLoopMaxMs: nanosecondsToMilliseconds(histogram.max),
      eventLoopUtilization: utilization,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      ...(options.getContext?.() ?? {}),
    }
    histogram.reset()
    if (result.eventLoopP99Ms >= (options.warnThresholdMs ?? DEFAULT_EVENT_LOOP_WARN_THRESHOLD_MS)) {
      dependencies.logger.warn(result, 'Slow event loop detected')
    } else {
      dependencies.logger.debug(result, 'Event loop metrics sampled')
    }
    return result
  }

  return {
    start(): void {
      if (timer !== undefined) return
      histogram.enable()
      baseline = dependencies.eventLoopUtilization()
      timer = dependencies.setInterval(sample, options.intervalMs ?? DEFAULT_EVENT_LOOP_MONITOR_INTERVAL_MS)
      unrefTimer(timer)
    },
    sample,
    stop(): void {
      if (timer === undefined) return
      dependencies.clearInterval(timer)
      timer = undefined
      histogram.disable()
    },
  }
}

function defaultDependencies(service: string): EventLoopMonitorDependencies {
  return {
    createHistogram: () => monitorEventLoopDelay({ resolution: 10 }),
    eventLoopUtilization: () => performance.eventLoopUtilization(),
    memoryUsage: () => process.memoryUsage(),
    setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
    clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
    logger: createChildLogger(`event-loop:${service}`),
  }
}

function utilizationDelta(previous: EventLoopUtilization | undefined, current: EventLoopUtilization): number {
  if (!previous) return current.utilization
  const active = Math.max(0, current.active - previous.active)
  const idle = Math.max(0, current.idle - previous.idle)
  const total = active + idle
  return total > 0 ? active / total : 0
}

function nanosecondsToMilliseconds(value: number): number {
  return Number.isFinite(value) ? value / 1_000_000 : 0
}

function unrefTimer(timer: unknown): void {
  if (!timer || typeof timer !== 'object' || !('unref' in timer)) return
  const unref = (timer as { unref?: () => void }).unref
  unref?.call(timer)
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
