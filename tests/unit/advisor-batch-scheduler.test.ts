import { afterEach, expect, test, vi } from 'vitest'
import { createAdvisorBatchScheduler, ADVISOR_BATCH_MS } from '../../src/core/advisor-batch-scheduler.js'
import type { SessionDoneData } from '../../src/types/ws-protocol.js'

const event = (sessionId: string, turnId = sessionId): SessionDoneData => ({
  sessionId, agentId: 'agent', messageId: turnId, turnId, stopReason: 'end_turn',
})
afterEach(() => vi.useRealTimers())

test('waits a fixed window and merges the latest event from each session', async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockResolvedValue(undefined)
  const scheduler = createAdvisorBatchScheduler(run)
  scheduler.add('p', event('a', 'old'))
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS / 2)
  scheduler.add('p', event('a', 'new'))
  scheduler.add('p', event('b'))
  expect(run).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS / 2)
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0]![1]).toEqual([event('a', 'new'), event('b')])
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS * 3)
  expect(run).toHaveBeenCalledTimes(1)
  scheduler.dispose()
})

test('retains changes while busy and waits another window after completion', async () => {
  vi.useFakeTimers()
  let finish: () => void = () => undefined
  const run = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    .mockResolvedValue(undefined)
  const scheduler = createAdvisorBatchScheduler(run)
  scheduler.add('p', event('a'))
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
  scheduler.add('p', event('b'))
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS * 3)
  expect(run).toHaveBeenCalledTimes(1)
  finish()
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS - 1)
  expect(run).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(run.mock.calls[1]![1]).toEqual([event('b')])
  scheduler.dispose()
})

test('reset clears pending work and invalidates queued dispatch without concurrent runs', async () => {
  vi.useFakeTimers()
  let valid: () => boolean = () => true
  let finish: () => void = () => undefined
  const run = vi.fn().mockImplementationOnce((_project, _events, isCurrent) => {
    valid = isCurrent
    return new Promise<void>((resolve) => { finish = resolve })
  }).mockResolvedValue(undefined)
  const scheduler = createAdvisorBatchScheduler(run)
  scheduler.add('p', event('a'))
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
  scheduler.reset('p')
  expect(valid()).toBe(false)
  scheduler.add('p', event('b'))
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
  expect(run).toHaveBeenCalledTimes(1)
  finish()
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
  expect(run).toHaveBeenCalledTimes(2)
  scheduler.add('q', event('q'))
  scheduler.reset('q')
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
  expect(run).toHaveBeenCalledTimes(2)
  scheduler.dispose()
})

test('failure does not retry forever or prevent later changes', async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const scheduler = createAdvisorBatchScheduler(run)
  scheduler.add('p', event('a'))
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS * 3)
  expect(run).toHaveBeenCalledTimes(1)
  scheduler.add('p', event('b'))
  await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
  expect(run).toHaveBeenCalledTimes(2)
  scheduler.dispose()
})
