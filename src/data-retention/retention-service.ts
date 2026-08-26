import { createChildLogger } from '../core/logger.js'
import type { RetentionBatchResult, RetentionInspectResult, WriteDataPort } from '../ports/write-data-port.js'

const log = createChildLogger('data-retention')
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000
const KEEP_TURNS = 15

export type DataRetentionMode = 'off' | 'dry-run' | 'delete'

export interface DataRetentionStatus {
  configuredMode: DataRetentionMode
  state: 'idle' | 'running' | 'stopping'
  activeMode: Exclude<DataRetentionMode, 'off'> | null
  startedAt: string | null
  nextScheduledAt: string | null
  batches: number
  deletedProcessRows: number
  deletedEventRows: number
  lastInspect: RetentionInspectResult | null
  lastError: string | null
}

interface DataRetentionServiceOptions {
  writeDataPort: WriteDataPort
  mode: DataRetentionMode
  now?: () => number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
  startupDelayMs?: number
  batchIntervalMs?: number
  retryDelayMs?: number
  batchRows?: number
}

export class DataRetentionService {
  private readonly writeDataPort: WriteDataPort
  private readonly mode: DataRetentionMode
  private readonly now: () => number
  private readonly setTimer: typeof setTimeout
  private readonly clearTimer: typeof clearTimeout
  private readonly startupDelayMs: number
  private readonly batchIntervalMs: number
  private readonly retryDelayMs: number
  private readonly initialBatchRows: number
  private timer?: NodeJS.Timeout
  private active?: Promise<void>
  private stopRequested = false
  private closed = false
  private nextScheduledAt: string | null = null
  private statusValue: DataRetentionStatus

  constructor(options: DataRetentionServiceOptions) {
    this.writeDataPort = options.writeDataPort
    this.mode = options.mode
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimer ?? setTimeout
    this.clearTimer = options.clearTimer ?? clearTimeout
    this.startupDelayMs = options.startupDelayMs ?? 60_000
    this.batchIntervalMs = options.batchIntervalMs ?? 1_000
    this.retryDelayMs = options.retryDelayMs ?? 30_000
    this.initialBatchRows = options.batchRows ?? 500
    this.statusValue = this.initialStatus()
  }

  start(): void {
    if (this.mode === 'off' || this.closed) return
    this.scheduleNext(this.delayUntilNextRun())
  }

  status(): DataRetentionStatus {
    return { ...this.statusValue, lastInspect: this.statusValue.lastInspect && { ...this.statusValue.lastInspect } }
  }

  async dryRun(): Promise<RetentionInspectResult> {
    this.assertIdle()
    try {
      return await this.runInspect()
    } catch (err) {
      this.statusValue.lastError = errorMessage(err)
      log.error({ err }, 'manual data retention dry-run failed')
      throw err
    }
  }

  startDelete(): DataRetentionStatus {
    this.assertIdle()
    this.beginRun('delete', false)
    return this.status()
  }

  stop(): DataRetentionStatus {
    if (this.statusValue.state === 'running') {
      this.stopRequested = true
      this.statusValue.state = 'stopping'
    }
    return this.status()
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer) this.clearTimer(this.timer)
    this.timer = undefined
    this.nextScheduledAt = null
    this.stopRequested = true
    await this.active
  }

  private beginRun(mode: Exclude<DataRetentionMode, 'off'>, scheduled: boolean): void {
    this.resetRunStatus(mode)
    this.active = (mode === 'dry-run' ? this.runInspect().then(() => undefined) : this.runDelete(scheduled))
      .catch((err: unknown) => {
        this.statusValue.lastError = errorMessage(err)
        log.error({ err, mode, scheduled }, 'data retention run failed')
      })
      .finally(() => {
        this.statusValue.state = 'idle'
        this.statusValue.activeMode = null
        this.active = undefined
        if (scheduled && !this.closed) this.scheduleNext(this.delayUntilNextRun(true))
      })
  }

  private async runInspect(): Promise<RetentionInspectResult> {
    if (this.statusValue.state === 'idle') this.resetRunStatus('dry-run')
    try {
      const result = await this.writeDataPort.inspectRetention(this.retentionInput())
      this.statusValue.lastInspect = result
      log.info(result, 'data retention dry-run completed')
      return result
    } finally {
      if (!this.active) {
        this.statusValue.state = 'idle'
        this.statusValue.activeMode = null
      }
    }
  }

  private async runDelete(scheduled: boolean): Promise<void> {
    let batchRows = this.initialBatchRows
    while (!this.stopRequested && (!scheduled || isBeijingCleanupWindow(this.now()))) {
      try {
        const result = await this.writeDataPort.runRetentionBatch({
          ...this.retentionInput(),
          batchRows,
        })
        this.recordBatch(result)
        if (!result.hasMore) break
        if (result.elapsedMs > 100) batchRows = Math.max(25, Math.floor(batchRows / 2))
        await this.delay(this.batchIntervalMs)
      } catch (err) {
        this.statusValue.lastError = errorMessage(err)
        log.warn({ err, batchRows }, 'data retention batch failed; retrying later')
        await this.delay(this.retryDelayMs)
      }
    }
  }

  private recordBatch(result: RetentionBatchResult): void {
    this.statusValue.batches += 1
    this.statusValue.deletedProcessRows += result.deletedProcessRows
    this.statusValue.deletedEventRows += result.deletedEventRows
    log.info({ ...result, batches: this.statusValue.batches }, 'data retention batch applied')
  }

  private resetRunStatus(mode: Exclude<DataRetentionMode, 'off'>): void {
    this.stopRequested = false
    this.statusValue = {
      ...this.initialStatus(),
      state: 'running',
      activeMode: mode,
      startedAt: new Date(this.now()).toISOString(),
      nextScheduledAt: this.nextScheduledAt,
    }
  }

  private initialStatus(): DataRetentionStatus {
    return {
      configuredMode: this.mode,
      state: 'idle',
      activeMode: null,
      startedAt: null,
      nextScheduledAt: this.nextScheduledAt ?? null,
      batches: 0,
      deletedProcessRows: 0,
      deletedEventRows: 0,
      lastInspect: null,
      lastError: null,
    }
  }

  private retentionInput(): { cutoff: string; keepTurns: number } {
    return {
      cutoff: new Date(this.now() - MIN_AGE_MS).toISOString(),
      keepTurns: KEEP_TURNS,
    }
  }

  private assertIdle(): void {
    if (this.statusValue.state !== 'idle' || this.active) {
      throw new Error('Data retention is already running')
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.closed) return
    if (this.timer) this.clearTimer(this.timer)
    const scheduledAt = this.now() + delayMs
    this.nextScheduledAt = new Date(scheduledAt).toISOString()
    this.statusValue.nextScheduledAt = this.nextScheduledAt
    this.timer = this.setTimer(() => {
      this.timer = undefined
      this.nextScheduledAt = null
      if (this.active || this.statusValue.state !== 'idle') {
        this.scheduleNext(isBeijingCleanupWindow(this.now()) ? 60_000 : this.delayUntilNextRun(true))
        return
      }
      this.beginRun(this.mode === 'delete' ? 'delete' : 'dry-run', true)
    }, delayMs)
    this.timer.unref?.()
  }

  private delayUntilNextRun(forceTomorrow = false): number {
    const now = this.now()
    if (!forceTomorrow && isBeijingCleanupWindow(now)) return this.startupDelayMs
    return millisecondsUntilNextBeijingHour(now, 2, forceTomorrow)
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = this.setTimer(resolve, milliseconds)
      timer.unref?.()
    })
  }
}

export function isBeijingCleanupWindow(timestamp: number): boolean {
  const beijing = new Date(timestamp + BEIJING_OFFSET_MS)
  const hour = beijing.getUTCHours()
  return hour >= 2 && hour < 6
}

export function millisecondsUntilNextBeijingHour(timestamp: number, targetHour: number, forceTomorrow = false): number {
  const beijing = new Date(timestamp + BEIJING_OFFSET_MS)
  const localMidnight =
    Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate()) - BEIJING_OFFSET_MS
  let target = localMidnight + targetHour * 60 * 60 * 1000
  if (forceTomorrow || target <= timestamp) target += 24 * 60 * 60 * 1000
  return target - timestamp
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
