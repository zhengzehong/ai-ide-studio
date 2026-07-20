import type { SessionUpdateData } from '../types/ws-protocol.js'
import { onBeforeDatabaseClose } from '../store/db.js'

export interface SessionUpdateEnvelope {
  sessionId: string
  agentId: string
  data: SessionUpdateData
}

export type ApplySessionUpdate = (ev: SessionUpdateEnvelope) => void

export interface SessionUpdateBatcherOptions {
  textFlushMs?: number
  processFlushMs?: number
}

interface PendingUpdate {
  ev: SessionUpdateEnvelope
  timer?: NodeJS.Timeout
}

const DEFAULT_TEXT_FLUSH_MS = 100
const DEFAULT_PROCESS_FLUSH_MS = 300
const activeBatchers = new Set<SessionUpdateBatcher>()

onBeforeDatabaseClose(() => {
  for (const batcher of activeBatchers) batcher.clearPending()
})

export class SessionUpdateBatcher {
  private readonly textFlushMs: number
  private readonly processFlushMs: number
  private readonly pending = new Map<string, PendingUpdate>()

  constructor(options: SessionUpdateBatcherOptions = {}) {
    this.textFlushMs = options.textFlushMs ?? DEFAULT_TEXT_FLUSH_MS
    this.processFlushMs = options.processFlushMs ?? DEFAULT_PROCESS_FLUSH_MS
    activeBatchers.add(this)
  }

  handle(ev: SessionUpdateEnvelope, apply: ApplySessionUpdate): void {
    if (!isMergeable(ev.data)) {
      this.flushSession(ev.sessionId, apply)
      apply(ev)
      return
    }

    const key = pendingKey(ev)
    const existing = this.pending.get(key)
    if (existing) {
      existing.ev = mergeEnvelope(existing.ev, ev)
      return
    }

    const pending: PendingUpdate = { ev }
    pending.timer = setTimeout(() => {
      this.pending.delete(key)
      apply(pending.ev)
    }, flushDelay(ev.data, this.textFlushMs, this.processFlushMs))
    this.pending.set(key, pending)
  }

  flushSession(sessionId: string, apply: ApplySessionUpdate): void {
    for (const [key, pending] of [...this.pending]) {
      if (pending.ev.sessionId !== sessionId) continue
      if (pending.timer) clearTimeout(pending.timer)
      this.pending.delete(key)
      apply(pending.ev)
    }
  }

  dispose(): void {
    activeBatchers.delete(this)
    this.clearPending()
  }

  clearPending(): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
    }
    this.pending.clear()
  }
}

function isMergeable(data: SessionUpdateData): boolean {
  if (data.permissionRequest || data.elicitationRequest || data.plan) return false
  if (data.eventType?.startsWith('lifecycle.')) return false
  if (data.eventType === 'permission.result' || data.eventType === 'elicitation.result') return false
  if (data.usage || data.configOptions || data.commands || data.sessionInfo) return false
  if (data.role === 'agent' && (data.contentDelta || data.content || data.thinking)) return true
  if (data.role === 'agent' && data.toolCallUpdate && !isTerminalToolStatus(data.toolCallUpdate.status)) return true
  return false
}

function isTerminalToolStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'error' || status === 'cancelled'
}

function pendingKey(ev: SessionUpdateEnvelope): string {
  const data = ev.data
  const kind = data.contentDelta || data.content ? 'content' : data.thinking ? 'thinking' : data.toolCallUpdate ? `tool:${data.toolCallUpdate.id}` : 'other'
  return `${ev.sessionId}:${data.messageId ?? ''}:${kind}`
}

function flushDelay(data: SessionUpdateData, textFlushMs: number, processFlushMs: number): number {
  return data.contentDelta || data.content ? textFlushMs : processFlushMs
}

function mergeEnvelope(current: SessionUpdateEnvelope, next: SessionUpdateEnvelope): SessionUpdateEnvelope {
  return {
    ...current,
    agentId: next.agentId,
    data: mergeData(current.data, next.data),
  }
}

function mergeData(current: SessionUpdateData, next: SessionUpdateData): SessionUpdateData {
  if (current.contentDelta || next.contentDelta || current.content || next.content) {
    return {
      ...current,
      ...next,
      content: undefined,
      contentDelta: `${current.contentDelta ?? current.content ?? ''}${next.contentDelta ?? next.content ?? ''}`,
    }
  }

  if (current.thinking || next.thinking) {
    return {
      ...current,
      ...next,
      thinking: `${current.thinking ?? ''}${next.thinking ?? ''}`,
    }
  }

  if (current.toolCallUpdate && next.toolCallUpdate) {
    return {
      ...current,
      ...next,
      toolCallUpdate: {
        ...current.toolCallUpdate,
        ...next.toolCallUpdate,
        progressDelta: `${current.toolCallUpdate.progressDelta ?? ''}${next.toolCallUpdate.progressDelta ?? ''}` || next.toolCallUpdate.progressDelta,
        terminalOutputDelta: `${current.toolCallUpdate.terminalOutputDelta ?? ''}${next.toolCallUpdate.terminalOutputDelta ?? ''}` || next.toolCallUpdate.terminalOutputDelta,
      },
    }
  }

  return { ...current, ...next }
}
