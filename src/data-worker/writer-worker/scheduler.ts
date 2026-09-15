import type { WritePriority } from '../protocol.js'

export interface WriterSchedulerItem<TValue> {
  value: TValue
  priority: WritePriority
  sessionId?: string
  mutationCount: number
  payloadBytes: number
}

export interface WriterSchedulerOptions<TValue, TResult> {
  executeBatch: (items: WriterSchedulerItem<TValue>[]) => Promise<TResult[]>
  backgroundFlushMs?: number
  maxMutations?: number
  maxPayloadBytes?: number
}

interface PendingItem<TValue, TResult> extends WriterSchedulerItem<TValue> {
  resolve: (result: TResult) => void
  reject: (error: unknown) => void
}

const DEFAULT_BACKGROUND_FLUSH_MS = 25
const DEFAULT_MAX_MUTATIONS = 100
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024

export class WriterScheduler<TValue, TResult> {
  private readonly executeBatch: WriterSchedulerOptions<TValue, TResult>['executeBatch']
  private readonly backgroundFlushMs: number
  private readonly maxMutations: number
  private readonly maxPayloadBytes: number
  private readonly critical: PendingItem<TValue, TResult>[] = []
  private readonly interactive: PendingItem<TValue, TResult>[] = []
  private readonly background: PendingItem<TValue, TResult>[] = []
  private readonly drainWaiters = new Set<() => void>()
  private backgroundTimer?: NodeJS.Timeout
  private backgroundReady = false
  private forceDrain = false
  private scheduled = false
  private processing = false
  private lastActivityAt = 0

  constructor(options: WriterSchedulerOptions<TValue, TResult>) {
    this.executeBatch = options.executeBatch
    this.backgroundFlushMs = options.backgroundFlushMs ?? DEFAULT_BACKGROUND_FLUSH_MS
    this.maxMutations = options.maxMutations ?? DEFAULT_MAX_MUTATIONS
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES
  }

  get pendingCount(): number {
    return this.critical.length + this.interactive.length + this.background.length
  }

  /** 最近一次批次执行结束的时间戳(ms);供 maintenance 判断"写通道已空闲多久"。 */
  get lastBatchActivityAt(): number {
    return this.lastActivityAt
  }

  enqueue(item: WriterSchedulerItem<TValue>): Promise<TResult> {
    validateItem(item)
    const result = new Promise<TResult>((resolve, reject) => {
      const pending: PendingItem<TValue, TResult> = { ...item, resolve, reject }
      if (item.priority === 'critical') this.critical.push(pending)
      else if (item.priority === 'interactive') this.interactive.push(pending)
      else this.background.push(pending)
    })

    if (item.priority === 'background') {
      if (this.backgroundThresholdReached()) {
        this.backgroundReady = true
        this.clearBackgroundTimer()
        this.schedule()
      } else {
        this.ensureBackgroundTimer()
      }
    } else {
      this.schedule()
    }
    return result
  }

  async drain(): Promise<void> {
    if (this.isIdle()) return
    this.forceDrain = true
    this.backgroundReady = true
    this.clearBackgroundTimer()
    this.schedule()
    await new Promise<void>((resolve) => this.drainWaiters.add(resolve))
  }

  private schedule(): void {
    if (this.scheduled || this.processing) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.processAvailable()
    })
  }

  private async processAvailable(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (true) {
        const critical = this.critical.shift()
        if (critical) {
          await this.flushBackgroundForSession(critical.sessionId)
          await this.executeItems([critical])
          continue
        }

        const interactive = this.interactive.shift()
        if (interactive) {
          await this.executeItems([interactive])
          continue
        }

        if ((this.forceDrain || this.backgroundReady) && this.background.length > 0) {
          const batch = takeBoundedBatch(
            this.background,
            this.maxMutations,
            this.maxPayloadBytes,
          )
          await this.executeItems(batch)
          this.backgroundReady = this.forceDrain || this.backgroundThresholdReached()
          continue
        }
        break
      }
    } finally {
      this.processing = false
      if (this.isIdle()) {
        this.forceDrain = false
        this.backgroundReady = false
        this.resolveDrainWaiters()
      } else if (this.critical.length > 0 || this.interactive.length > 0 || this.backgroundReady) {
        this.schedule()
      } else {
        this.ensureBackgroundTimer()
      }
    }
  }

  private async flushBackgroundForSession(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return
    const matching: PendingItem<TValue, TResult>[] = []
    for (let index = this.background.length - 1; index >= 0; index -= 1) {
      if (this.background[index].sessionId !== sessionId) continue
      matching.unshift(this.background[index])
      this.background.splice(index, 1)
    }
    while (matching.length > 0) {
      await this.executeItems(takeBoundedBatch(
        matching,
        this.maxMutations,
        this.maxPayloadBytes,
      ))
    }
    if (this.background.length === 0) this.clearBackgroundTimer()
  }

  private async executeItems(items: PendingItem<TValue, TResult>[]): Promise<void> {
    try {
      const results = await this.executeBatch(items)
      if (results.length !== items.length) {
        throw new Error(`Writer batch result count mismatch: expected ${items.length}, got ${results.length}`)
      }
      items.forEach((item, index) => item.resolve(results[index]))
    } catch (error) {
      for (const item of items) item.reject(error)
    } finally {
      this.lastActivityAt = Date.now()
    }
  }

  private backgroundThresholdReached(): boolean {
    let mutations = 0
    let bytes = 0
    for (const item of this.background) {
      mutations += item.mutationCount
      bytes += item.payloadBytes
      if (mutations >= this.maxMutations || bytes >= this.maxPayloadBytes) return true
    }
    return false
  }

  private ensureBackgroundTimer(): void {
    if (this.backgroundTimer || this.background.length === 0) return
    this.backgroundTimer = setTimeout(() => {
      this.backgroundTimer = undefined
      this.backgroundReady = true
      this.schedule()
    }, this.backgroundFlushMs)
  }

  private clearBackgroundTimer(): void {
    if (!this.backgroundTimer) return
    clearTimeout(this.backgroundTimer)
    this.backgroundTimer = undefined
  }

  private isIdle(): boolean {
    return !this.processing
      && !this.scheduled
      && this.critical.length === 0
      && this.interactive.length === 0
      && this.background.length === 0
  }

  private resolveDrainWaiters(): void {
    for (const resolve of this.drainWaiters) resolve()
    this.drainWaiters.clear()
  }
}

function takeBoundedBatch<TValue, TResult>(
  source: PendingItem<TValue, TResult>[],
  maxMutations: number,
  maxPayloadBytes: number,
): PendingItem<TValue, TResult>[] {
  const result: PendingItem<TValue, TResult>[] = []
  let mutations = 0
  let bytes = 0
  while (source.length > 0) {
    const candidate = source[0]
    const exceeds = result.length > 0 && (
      mutations + candidate.mutationCount > maxMutations
      || bytes + candidate.payloadBytes > maxPayloadBytes
    )
    if (exceeds) break
    result.push(source.shift() as PendingItem<TValue, TResult>)
    mutations += candidate.mutationCount
    bytes += candidate.payloadBytes
  }
  return result
}

function validateItem<TValue>(item: WriterSchedulerItem<TValue>): void {
  if (!Number.isInteger(item.mutationCount) || item.mutationCount < 1) {
    throw new Error('Writer mutationCount must be a positive integer')
  }
  if (!Number.isFinite(item.payloadBytes) || item.payloadBytes < 0) {
    throw new Error('Writer payloadBytes must be a non-negative number')
  }
}
