import type { RealtimeCursor, ServerMessage } from '../types/ws-protocol.js'
import { createChildLogger } from '../shared/logger.js'

const log = createChildLogger('realtime:outbound-queue')

export interface RealtimeOutboundQueueOptions {
  maxMessages: number
  maxBytes: number
}

export interface QueuedRealtimeFrame {
  message: ServerMessage
  payload: string
  byteLength: number
  critical: boolean
  cursor?: RealtimeCursor & { sessionId: string }
}

export interface QueueEnqueueResult {
  accepted: boolean
  resyncRequired: boolean
  closeRecommended: boolean
}

interface QueueEntry extends QueuedRealtimeFrame {
  coalesceKey?: string
  coalesceKind?: 'text' | 'process-item'
}

export class RealtimeOutboundQueue {
  private readonly entries: QueueEntry[] = []
  private totalBytes = 0
  private resyncPending = false
  private readonly oversizeRequests = new Map<string, number>()

  constructor(private readonly options: RealtimeOutboundQueueOptions) {
    if (!Number.isInteger(options.maxMessages) || options.maxMessages < 1) {
      throw new Error('Realtime maxMessages must be a positive integer')
    }
    if (!Number.isInteger(options.maxBytes) || options.maxBytes < 1) {
      throw new Error('Realtime maxBytes must be a positive integer')
    }
  }

  get size(): number {
    return this.entries.length
  }

  get bytes(): number {
    return this.totalBytes
  }

  enqueue(message: ServerMessage): QueueEnqueueResult {
    const critical = isCritical(message)
    if (this.resyncPending && !critical && message.type !== 'resync_required') {
      return { accepted: false, resyncRequired: true, closeRecommended: false }
    }

    const entry = createEntry(message, critical)
    if (entry.byteLength > this.options.maxBytes) {
      if (message.type === 'result') {
        // 超限体面降级(P1):列表类结果先试"截断留尾",把能装下的部分照常发出去。
        // 旧行为是直接回「查询结果过大」——生产实证 2026-09-12 15:11 一分钟内
        // req-6139~6162 连续 24 次被拒(客户端逐页/逐会话地拿不到数据又继续请求)。
        // 截断后客户端至少能渲染最新一段,不会陷入"拿不到就再问"的循环。
        const degraded = this.truncateOversizedResult(message)
        if (degraded) {
          const degradedEntry = createEntry(degraded.message, critical)
          if (degradedEntry.byteLength <= this.options.maxBytes) {
            log.warn({
              requestId: message.requestId,
              bytes: entry.byteLength,
              maxBytes: this.options.maxBytes,
              kept: degraded.kept,
              dropped: degraded.dropped,
              listKey: degraded.listKey,
            }, 'oversized RPC result truncated to fit the realtime frame limit')
            if (this.fits(degradedEntry)) {
              this.push(degradedEntry)
              return { accepted: true, resyncRequired: false, closeRecommended: false }
            }
            // 截断后仍装不下(队列本身已满):按控制类回复的既有策略处理,不静默丢。
            return { accepted: false, resyncRequired: true, closeRecommended: true }
          }
        }
        log.warn({ requestId: message.requestId, bytes: entry.byteLength, maxBytes: this.options.maxBytes }, 'RPC result exceeds realtime frame limit')
        // 同参重试合并:同一 requestId 只回一次错误帧,避免客户端重发时反复打墙/刷日志
        // (生产实证的 24 连拒是"逐页/逐会话的不同 requestId",由上面的截断路径承接;
        //  这里兜住"同一请求被重发"的那一类。)
        if (!message.requestId || !this.shouldHandleOversize(message.requestId)) {
          return { accepted: false, resyncRequired: false, closeRecommended: false }
        }
        return this.enqueue({ type: 'error', requestId: message.requestId, message: '查询结果过大，请缩小查询范围后重试' })
      }
      this.ensureResync(sessionIdOf(message), 'frame-too-large')
      return { accepted: false, resyncRequired: true, closeRecommended: critical }
    }

    if (entry.coalesceKey && this.replaceCoalesced(entry)) {
      if (this.totalBytes <= this.options.maxBytes) {
        return { accepted: true, resyncRequired: false, closeRecommended: false }
      }
      this.ensureResync(sessionIdOf(message), 'queue-bytes-exceeded')
      return { accepted: false, resyncRequired: true, closeRecommended: false }
    }

    if (this.fits(entry)) {
      this.push(entry)
      return { accepted: true, resyncRequired: false, closeRecommended: false }
    }

    // Control replies are not replayable. Never silently evict them or lose
    // realtime deltas to make room without informing the client.
    if (isControl(message)) {
      return { accepted: false, resyncRequired: true, closeRecommended: true }
    }

    if (critical) {
      this.evictNoncriticalUntilFits(entry)
      if (this.fits(entry)) {
        this.push(entry)
        return { accepted: true, resyncRequired: false, closeRecommended: false }
      }
      this.ensureResync(sessionIdOf(message), 'critical-queue-overflow')
      return { accepted: false, resyncRequired: true, closeRecommended: true }
    }

    this.ensureResync(sessionIdOf(message), 'outbound-queue-overflow')
    return { accepted: false, resyncRequired: true, closeRecommended: false }
  }

  enqueueResync(sessionId: string | undefined, reason: string): QueueEnqueueResult {
    return this.ensureResync(sessionId, reason)
  }

  acknowledgeResync(): void {
    this.resyncPending = false
  }

  shift(): QueuedRealtimeFrame | undefined {
    const entry = this.entries.shift()
    if (!entry) return undefined
    this.totalBytes -= entry.byteLength
    return entry
  }

  drain(): QueuedRealtimeFrame[] {
    const result: QueuedRealtimeFrame[] = []
    while (this.entries.length > 0) {
      const entry = this.shift()
      if (entry) result.push(entry)
    }
    return result
  }

  clear(): void {
    this.entries.length = 0
    this.totalBytes = 0
    this.resyncPending = false
  }

  /**
   * 超限列表结果的"截断留尾"降级(P1)。
   *
   * 返回可发送的替代消息 + 丢弃统计;不是列表(或单项就超限)时返回 null,
   * 由调用方走原来的错误分支。截断保留**尾部**(最新)若干项:这些查询的结果按时间/序列升序,
   * 最新的一段才是界面当前需要的内容。
   */
  private truncateOversizedResult(
    message: ServerMessage & { type: 'result' },
  ): { message: ServerMessage; listKey: string | null; kept: number; dropped: number } | null {
    const result = message.data
    if (result === null || result === undefined) return null
    const isArray = Array.isArray(result)
    const object = isArray ? null : (result as Record<string, unknown>)
    const listKey = isArray
      ? null
      : LIST_RESULT_KEYS.find((key) => Array.isArray(object?.[key])) ?? null
    const list = (isArray ? result : object?.[listKey ?? '']) as unknown[] | undefined
    if (!Array.isArray(list) || list.length === 0) return null

    const build = (items: unknown[]): ServerMessage => {
      if (isArray) return { ...message, data: items }
      const dropped = list.length - items.length
      return {
        ...message,
        data: { ...object, [listKey as string]: items, truncated: true, droppedCount: dropped, hasMore: true },
      }
    }

    const overhead = byteLengthOf(build([]))
    if (overhead >= this.options.maxBytes) return null
    let used = overhead
    let kept = 0
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const itemBytes = byteLengthOf(list[index]) + 1
      if (used + itemBytes > this.options.maxBytes) break
      used += itemBytes
      kept += 1
    }
    if (kept === 0 || kept >= list.length) return null
    return {
      message: build(list.slice(list.length - kept)),
      listKey,
      kept,
      dropped: list.length - kept,
    }
  }

  /** 同一 requestId 在 OVERSIZE_SUPPRESS_TTL_MS 内只处理一次;返回 false = 重复,静默丢弃。 */
  private shouldHandleOversize(requestId: string): boolean {
    const now = Date.now()
    for (const [id, at] of this.oversizeRequests) {
      if (now - at > OVERSIZE_SUPPRESS_TTL_MS) this.oversizeRequests.delete(id)
      else break
    }
    while (this.oversizeRequests.size >= OVERSIZE_SUPPRESS_MAX_ENTRIES) {
      const oldest = this.oversizeRequests.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.oversizeRequests.delete(oldest)
    }
    if (this.oversizeRequests.has(requestId)) return false
    this.oversizeRequests.set(requestId, now)
    return true
  }

  private replaceCoalesced(candidate: QueueEntry): boolean {    const index = findLastIndex(this.entries, (entry) => entry.coalesceKey === candidate.coalesceKey)
    if (index < 0) return false
    const previous = this.entries[index]
    const mergedMessage = candidate.coalesceKind === 'text'
      ? mergeTextUpdates(previous.message, candidate.message)
      : candidate.message
    const replacement = createEntry(mergedMessage, false)
    this.entries[index] = replacement
    this.totalBytes += replacement.byteLength - previous.byteLength
    return true
  }

  private ensureResync(sessionId: string | undefined, reason: string): QueueEnqueueResult {
    if (this.resyncPending) {
      return { accepted: false, resyncRequired: true, closeRecommended: false }
    }
    this.resyncPending = true
    log.warn({ sessionId, reason, queuedMessages: this.size, queuedBytes: this.bytes }, 'Realtime snapshot recovery required')
    const resync = createEntry({ type: 'resync_required', sessionId, reason }, true)
    this.evictNoncriticalUntilFits(resync)
    if (this.fits(resync)) this.push(resync)
    return {
      accepted: false,
      resyncRequired: true,
      closeRecommended: !this.entries.includes(resync),
    }
  }

  private evictNoncriticalUntilFits(candidate: QueueEntry): void {
    while (!this.fits(candidate)) {
      const index = this.entries.findIndex((entry) => !entry.critical)
      if (index < 0) return
      const [removed] = this.entries.splice(index, 1)
      this.totalBytes -= removed.byteLength
    }
  }

  private fits(entry: QueueEntry): boolean {
    return this.entries.length + 1 <= this.options.maxMessages
      && this.totalBytes + entry.byteLength <= this.options.maxBytes
  }

  private push(entry: QueueEntry): void {
    this.entries.push(entry)
    this.totalBytes += entry.byteLength
  }
}

/** 同一 requestId 的超限处理抑制窗口与容量上限。 */
const OVERSIZE_SUPPRESS_TTL_MS = 60_000
const OVERSIZE_SUPPRESS_MAX_ENTRIES = 200

/** 列表类 result 里可能承载"可就地截断"数组的字段名(按出现顺序探测)。 */
const LIST_RESULT_KEYS = ['items', 'events', 'messages', 'rows', 'data'] as const

function byteLengthOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8')
}

function createEntry(message: ServerMessage, critical: boolean): QueueEntry {  const payload = JSON.stringify(message)
  const entry: QueueEntry = {
    message,
    payload,
    byteLength: Buffer.byteLength(payload, 'utf8'),
    critical,
  }
  const cursor = cursorOf(message)
  const sessionId = sessionIdOf(message)
  if (cursor && sessionId) entry.cursor = { ...cursor, sessionId }
  if (message.type === 'session:update' && typeof message.data.contentDelta === 'string') {
    entry.coalesceKey = `text:${message.sessionId}:${message.data.messageId}`
    entry.coalesceKind = 'text'
  } else if (message.type === 'session:process_item') {
    entry.coalesceKey = `process:${message.sessionId}:${message.item.id}`
    entry.coalesceKind = 'process-item'
  }
  return entry
}

function mergeTextUpdates(previous: ServerMessage, next: ServerMessage): ServerMessage {
  if (previous.type !== 'session:update' || next.type !== 'session:update') return next
  return {
    ...next,
    data: {
      ...next.data,
      contentDelta: `${previous.data.contentDelta ?? ''}${next.data.contentDelta ?? ''}`,
    },
  }
}

function isCritical(message: ServerMessage): boolean {
  if (isControl(message)) return true
  if (message.type === 'session:done' || message.type === 'error' || message.type === 'resync_required') return true
  return message.type === 'session:update'
    && (message.data.permissionRequest !== undefined || message.data.elicitationRequest !== undefined)
}

function isControl(message: ServerMessage): boolean {
  return message.type === 'result' || message.type === 'pong' || message.type === 'resume:ack'
    || (message.type === 'error' && !!message.requestId)
}

function cursorOf(message: ServerMessage): RealtimeCursor | undefined {
  if (!('streamGeneration' in message) || !('sequence' in message)) return undefined
  return typeof message.streamGeneration === 'string' && typeof message.sequence === 'number'
    ? { streamGeneration: message.streamGeneration, sequence: message.sequence }
    : undefined
}

function sessionIdOf(message: ServerMessage): string | undefined {
  return 'sessionId' in message && typeof message.sessionId === 'string' ? message.sessionId : undefined
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index
  }
  return -1
}
