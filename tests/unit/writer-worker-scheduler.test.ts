import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WriterScheduler,
  type WriterSchedulerItem,
} from '../../src/data-worker/writer-worker/scheduler.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('WriterScheduler', () => {
  it('flushes background work after 25ms and resolves every item from one transaction', async () => {
    vi.useFakeTimers({ now: 0 })
    const { scheduler, batches } = createScheduler()
    const first = scheduler.enqueue(background('first', 'session-a'))
    const second = scheduler.enqueue(background('second', 'session-b'))

    await vi.advanceTimersByTimeAsync(24)
    expect(batches).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    await expect(Promise.all([first, second])).resolves.toEqual(['done:first', 'done:second'])
    expect(batches).toEqual([['first', 'second']])
  })

  it('flushes background work immediately at 100 mutations or 256KiB', async () => {
    vi.useFakeTimers({ now: 0 })
    const mutationThreshold = createScheduler()
    const byteThreshold = createScheduler()

    const mutations = mutationThreshold.scheduler.enqueue({
      ...background('mutations', 'session-a'),
      mutationCount: 100,
    })
    const bytes = byteThreshold.scheduler.enqueue({
      ...background('bytes', 'session-b'),
      payloadBytes: 256 * 1024,
    })
    await vi.advanceTimersByTimeAsync(0)

    await expect(mutations).resolves.toBe('done:mutations')
    await expect(bytes).resolves.toBe('done:bytes')
    expect(mutationThreshold.batches).toEqual([['mutations']])
    expect(byteThreshold.batches).toEqual([['bytes']])
  })

  it('commits each interactive request in its own transaction', async () => {
    const { scheduler, batches } = createScheduler()

    const first = scheduler.enqueue(interactive('first'))
    const second = scheduler.enqueue(interactive('second'))

    await expect(Promise.all([first, second])).resolves.toEqual(['done:first', 'done:second'])
    expect(batches).toEqual([['first'], ['second']])
  })

  it('flushes pending work for the same session before a critical request', async () => {
    vi.useFakeTimers({ now: 0 })
    const { scheduler, batches } = createScheduler()
    const sameSession = scheduler.enqueue(background('background-a', 'session-a'))
    const otherSession = scheduler.enqueue(background('background-b', 'session-b'))

    const critical = scheduler.enqueue({
      value: 'critical-a',
      priority: 'critical',
      sessionId: 'session-a',
      mutationCount: 1,
      payloadBytes: 10,
    })
    await vi.advanceTimersByTimeAsync(0)

    await expect(Promise.all([sameSession, critical])).resolves.toEqual([
      'done:background-a',
      'done:critical-a',
    ])
    expect(batches).toEqual([['background-a'], ['critical-a']])

    await vi.advanceTimersByTimeAsync(25)
    await expect(otherSession).resolves.toBe('done:background-b')
    expect(batches).toEqual([['background-a'], ['critical-a'], ['background-b']])
  })

  it('runs critical then interactive before unrelated background work', async () => {
    vi.useFakeTimers({ now: 0 })
    const { scheduler, batches } = createScheduler()
    const pending = [
      scheduler.enqueue(background('background', 'session-b')),
      scheduler.enqueue(interactive('interactive')),
      scheduler.enqueue({
        value: 'critical',
        priority: 'critical' as const,
        sessionId: 'session-a',
        mutationCount: 1,
        payloadBytes: 10,
      }),
    ]

    await vi.advanceTimersByTimeAsync(0)
    expect(batches).toEqual([['critical'], ['interactive']])

    await scheduler.drain()
    await expect(Promise.all(pending)).resolves.toEqual([
      'done:background',
      'done:interactive',
      'done:critical',
    ])
    expect(batches).toEqual([['critical'], ['interactive'], ['background']])
  })

  it('reports the number of requests waiting in its queues', async () => {
    vi.useFakeTimers({ now: 0 })
    const { scheduler } = createScheduler()
    const first = scheduler.enqueue(background('first', 'session-a'))
    const second = scheduler.enqueue(background('second', 'session-b'))

    expect(scheduler.pendingCount).toBe(2)

    await scheduler.drain()
    await expect(Promise.all([first, second])).resolves.toEqual(['done:first', 'done:second'])
    expect(scheduler.pendingCount).toBe(0)
  })
})

function createScheduler(): {
  scheduler: WriterScheduler<string, string>
  batches: string[][]
} {
  const batches: string[][] = []
  const scheduler = new WriterScheduler<string, string>({
    executeBatch: async (items: WriterSchedulerItem<string>[]) => {
      batches.push(items.map((item) => item.value))
      return items.map((item) => `done:${item.value}`)
    },
  })
  return { scheduler, batches }
}

function background(value: string, sessionId: string): WriterSchedulerItem<string> {
  return {
    value,
    priority: 'background',
    sessionId,
    mutationCount: 1,
    payloadBytes: 10,
  }
}

function interactive(value: string): WriterSchedulerItem<string> {
  return {
    value,
    priority: 'interactive',
    mutationCount: 1,
    payloadBytes: 10,
  }
}
