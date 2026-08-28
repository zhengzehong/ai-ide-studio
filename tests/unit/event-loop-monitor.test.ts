import { describe, expect, it, vi } from 'vitest'
import {
  createEventLoopMonitor,
  type EventLoopHistogram,
  type EventLoopMonitorDependencies,
} from '../../src/shared/event-loop-monitor.js'

describe('event-loop monitor', () => {
  it('starts and stops once, reports converted percentiles, utilization, memory, and context', () => {
    const fixture = createFixture()
    const monitor = createEventLoopMonitor(
      {
        service: 'realtime',
        intervalMs: 30_000,
        warnThresholdMs: 20,
        getContext: () => ({ connectionCount: 3, queuedMessages: 7 }),
      },
      fixture.dependencies,
    )

    monitor.start()
    monitor.start()
    const sample = monitor.sample()
    monitor.stop()
    monitor.stop()

    expect(fixture.histogram.enable).toHaveBeenCalledTimes(1)
    expect(fixture.histogram.disable).toHaveBeenCalledTimes(1)
    expect(fixture.setInterval).toHaveBeenCalledTimes(1)
    expect(fixture.clearInterval).toHaveBeenCalledTimes(1)
    expect(fixture.activeTimers.size).toBe(0)
    expect(sample).toMatchObject({
      service: 'realtime',
      eventLoopP50Ms: 1,
      eventLoopP95Ms: 8,
      eventLoopP99Ms: 25,
      eventLoopMaxMs: 30,
      eventLoopUtilization: 0.3,
      rssBytes: 1000,
      heapUsedBytes: 400,
      heapTotalBytes: 800,
      externalBytes: 50,
      connectionCount: 3,
      queuedMessages: 7,
    })
    expect(fixture.warn).toHaveBeenCalledWith(sample, 'Slow event loop detected')
    expect(fixture.debug).not.toHaveBeenCalled()
    expect(fixture.histogram.reset).toHaveBeenCalledTimes(1)
  })

  it('logs healthy samples at debug and interval callbacks stop after close', () => {
    const fixture = createFixture({ p99Ns: 5_000_000 })
    const monitor = createEventLoopMonitor(
      {
        service: 'api',
        intervalMs: 10,
        warnThresholdMs: 20,
      },
      fixture.dependencies,
    )
    monitor.start()

    fixture.runIntervals()
    monitor.stop()
    fixture.runIntervals()

    expect(fixture.debug).toHaveBeenCalledTimes(1)
    expect(fixture.warn).not.toHaveBeenCalled()
    expect(fixture.histogram.reset).toHaveBeenCalledTimes(1)
  })

  it('warns on one isolated max delay and includes attribution context', () => {
    const fixture = createFixture({ p99Ns: 5_000_000, maxNs: 350_000_000 })
    const recentSyncOperations = [{
      operationModule: 'gateway:http-query',
      operation: 'response.serialize',
      elapsedMs: 325,
    }]
    const monitor = createEventLoopMonitor(
      {
        service: 'api',
        warnThresholdMs: 50,
        maxWarnThresholdMs: 200,
        getContext: () => ({ recentSyncOperations }),
      },
      fixture.dependencies,
    )

    const sample = monitor.sample()

    expect(sample.eventLoopP99Ms).toBe(5)
    expect(sample.eventLoopMaxMs).toBe(350)
    expect(sample.recentSyncOperations).toEqual(recentSyncOperations)
    expect(fixture.warn).toHaveBeenCalledWith(sample, 'Slow event loop detected')
  })
})

function createFixture(options: { p99Ns?: number; maxNs?: number } = {}): {
  histogram: EventLoopHistogram
  dependencies: EventLoopMonitorDependencies
  setInterval: ReturnType<typeof vi.fn>
  clearInterval: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  activeTimers: Set<() => void>
  runIntervals(): void
} {
  const activeTimers = new Set<() => void>()
  const setInterval = vi.fn((callback: () => void) => {
    activeTimers.add(callback)
    return callback
  })
  const clearInterval = vi.fn((timer: unknown) => activeTimers.delete(timer as () => void))
  const debug = vi.fn()
  const warn = vi.fn()
  const histogram: EventLoopHistogram = {
    enable: vi.fn(),
    disable: vi.fn(),
    reset: vi.fn(),
    percentile: vi.fn(
      (percentile: number) =>
        ({
          50: 1_000_000,
          95: 8_000_000,
          99: options.p99Ns ?? 25_000_000,
        })[percentile] ?? 0,
    ),
    get max() {
      return options.maxNs ?? 30_000_000
    },
  }
  const utilization = [
    { idle: 90, active: 10, utilization: 0.1 },
    { idle: 160, active: 40, utilization: 0.2 },
    { idle: 230, active: 70, utilization: 0.3 },
  ]
  let utilizationIndex = 0
  return {
    histogram,
    setInterval,
    clearInterval,
    debug,
    warn,
    activeTimers,
    runIntervals: () => [...activeTimers].forEach((callback) => callback()),
    dependencies: {
      createHistogram: () => histogram,
      eventLoopUtilization: () => utilization[Math.min(utilizationIndex++, utilization.length - 1)],
      memoryUsage: () => ({
        rss: 1000,
        heapTotal: 800,
        heapUsed: 400,
        external: 50,
        arrayBuffers: 10,
      }),
      setInterval,
      clearInterval,
      logger: { debug, warn },
    },
  }
}
