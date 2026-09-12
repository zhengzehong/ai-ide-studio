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
        log.warn({ requestId: message.requestId, bytes: entry.byteLength, maxBytes: this.options.maxBytes }, 'RPC result exceeds realtime frame limit')
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

  private replaceCoalesced(candidate: QueueEntry): boolean {
    const index = findLastIndex(this.entries, (entry) => entry.coalesceKey === candidate.coalesceKey)
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

function createEntry(message: ServerMessage, critical: boolean): QueueEntry {
  const payload = JSON.stringify(message)
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
