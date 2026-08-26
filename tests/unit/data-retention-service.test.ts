import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DataRetentionService,
  isBeijingCleanupWindow,
  millisecondsUntilNextBeijingHour,
} from '../../src/data-retention/retention-service.js'
import type { RetentionBatchResult, WriteDataPort } from '../../src/ports/write-data-port.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('DataRetentionService', () => {
  it('calculates the Beijing 02:00-06:00 cleanup window', () => {
    expect(isBeijingCleanupWindow(Date.parse('2026-08-25T18:00:00.000Z'))).toBe(true)
    expect(isBeijingCleanupWindow(Date.parse('2026-08-25T21:59:59.000Z'))).toBe(true)
    expect(isBeijingCleanupWindow(Date.parse('2026-08-25T22:00:00.000Z'))).toBe(false)
    expect(millisecondsUntilNextBeijingHour(Date.parse('2026-08-25T17:00:00.000Z'), 2)).toBe(60 * 60 * 1000)
  })

  it('starts one minute after service startup inside the cleanup window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T18:30:00.000Z'))
    const writer = fakeWritePort()
    const service = new DataRetentionService({ writeDataPort: writer, mode: 'dry-run' })

    service.start()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(writer.inspectRetention).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(writer.inspectRetention).toHaveBeenCalledOnce()
    expect(service.status().nextScheduledAt).toBeTruthy()
    await service.close()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(writer.inspectRetention).toHaveBeenCalledOnce()
  })

  it('rejects a duplicate manual run and returns to idle after the active batch', async () => {
    let release: ((result: RetentionBatchResult) => void) | undefined
    const batch = new Promise<RetentionBatchResult>((resolve) => {
      release = resolve
    })
    const writer = fakeWritePort({ runRetentionBatch: vi.fn(() => batch) })
    const service = new DataRetentionService({ writeDataPort: writer, mode: 'off', batchIntervalMs: 0 })

    expect(service.startDelete()).toMatchObject({ state: 'running', activeMode: 'delete' })
    await expect(service.dryRun()).rejects.toThrow('already running')
    release?.({
      messageId: 'message-old',
      resetProcessItemCount: true,
      deletedProcessRows: 2,
      deletedEventRows: 3,
      hasMore: false,
      elapsedMs: 10,
    })
    await vi.waitFor(() =>
      expect(service.status()).toMatchObject({
        state: 'idle',
        batches: 1,
        deletedProcessRows: 2,
        deletedEventRows: 3,
      }),
    )
    await service.close()
  })

  it('does not overlap a scheduled run with an active manual run', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T17:59:30.000Z'))
    let release: ((result: RetentionBatchResult) => void) | undefined
    const writer = fakeWritePort({
      runRetentionBatch: vi.fn(() => new Promise<RetentionBatchResult>((resolve) => { release = resolve })),
    })
    const service = new DataRetentionService({ writeDataPort: writer, mode: 'dry-run' })
    service.start()
    service.startDelete()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(writer.inspectRetention).not.toHaveBeenCalled()
    release?.({
      messageId: null,
      resetProcessItemCount: false,
      deletedProcessRows: 0,
      deletedEventRows: 0,
      hasMore: false,
      elapsedMs: 1,
    })
    await vi.waitFor(() => expect(service.status().state).toBe('idle'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(writer.inspectRetention).toHaveBeenCalledOnce()
    await service.close()
  })
})

function fakeWritePort(overrides: Partial<WriteDataPort> = {}): WriteDataPort {
  return {
    commitBatch: vi.fn(async () => {
      throw new Error('not used')
    }),
    sessionCursor: vi.fn(async () => ({ sequence: 0 })),
    enqueueRuntimeCommand: vi.fn(async () => {
      throw new Error('not used')
    }),
    listRecoverableRuntimeCommands: vi.fn(async () => []),
    updateRuntimeCommand: vi.fn(async () => {
      throw new Error('not used')
    }),
    maintain: vi.fn(async () => ({
      walBytesBefore: 0,
      walBytesAfter: 0,
      checkpointAttempted: false,
      checkpointMode: 'none',
      checkpointBusyPages: 0,
      checkpointLogPages: 0,
      checkpointedPages: 0,
      optimized: false,
      deletedPublishedOutboxRows: 0,
      elapsedMs: 0,
    })),
    inspectRetention: vi.fn(async () => ({
      eligibleMessages: 0,
      processRows: 0,
      eventRows: 0,
      estimatedBytes: 0,
    })),
    runRetentionBatch: vi.fn(async () => ({
      messageId: null,
      resetProcessItemCount: false,
      deletedProcessRows: 0,
      deletedEventRows: 0,
      hasMore: false,
      elapsedMs: 0,
    })),
    drain: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  }
}
