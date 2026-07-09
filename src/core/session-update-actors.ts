import type { SessionUpdateEnvelope } from './session-update-batcher.js'
import type { SessionUpdateData } from '../types/ws-protocol.js'

export type ScheduleDrain = (drain: () => void) => void
export type HandleSessionUpdate = (ev: SessionUpdateEnvelope) => void

export interface SessionUpdateActorSchedulerOptions {
  handleUpdate: HandleSessionUpdate
  eventBudgetPerSession?: number
  scheduleDrain?: ScheduleDrain
}

const DEFAULT_EVENT_BUDGET_PER_SESSION = 25

export class SessionUpdateActorScheduler {
  private readonly handleUpdate: HandleSessionUpdate
  private readonly eventBudgetPerSession: number
  private readonly scheduleDrain: ScheduleDrain
  private readonly queues = new Map<string, SessionUpdateEnvelope[]>()
  private readonly activeSessionIds: string[] = []
  private readonly activeSessionSet = new Set<string>()
  private drainScheduled = false

  constructor(options: SessionUpdateActorSchedulerOptions) {
    this.handleUpdate = options.handleUpdate
    this.eventBudgetPerSession = Math.max(1, Math.floor(options.eventBudgetPerSession ?? DEFAULT_EVENT_BUDGET_PER_SESSION))
    this.scheduleDrain = options.scheduleDrain ?? ((drain) => setImmediate(drain))
  }

  enqueue(ev: SessionUpdateEnvelope): void {
    if (isCriticalUpdate(ev.data)) {
      this.flushSession(ev.sessionId)
      this.handleUpdate(ev)
      return
    }

    const queue = this.queues.get(ev.sessionId)
    if (queue) {
      queue.push(ev)
    } else {
      this.queues.set(ev.sessionId, [ev])
    }
    this.activateSession(ev.sessionId)
    this.ensureDrainScheduled()
  }

  flushSession(sessionId: string): void {
    this.deactivateSession(sessionId)
    const queue = this.queues.get(sessionId)
    if (!queue) return
    this.queues.delete(sessionId)
    for (const ev of queue) {
      this.handleUpdate(ev)
    }
  }

  dispose(): void {
    this.queues.clear()
    this.activeSessionIds.length = 0
    this.activeSessionSet.clear()
    this.drainScheduled = false
  }

  private activateSession(sessionId: string): void {
    if (this.activeSessionSet.has(sessionId)) return
    this.activeSessionSet.add(sessionId)
    this.activeSessionIds.push(sessionId)
  }

  private deactivateSession(sessionId: string): void {
    if (!this.activeSessionSet.delete(sessionId)) return
    const index = this.activeSessionIds.indexOf(sessionId)
    if (index >= 0) this.activeSessionIds.splice(index, 1)
  }

  private ensureDrainScheduled(): void {
    if (this.drainScheduled) return
    this.drainScheduled = true
    this.scheduleDrain(() => this.drainNextSession())
  }

  private drainNextSession(): void {
    this.drainScheduled = false
    const sessionId = this.activeSessionIds.shift()
    if (!sessionId) return
    this.activeSessionSet.delete(sessionId)

    const queue = this.queues.get(sessionId)
    if (!queue || queue.length === 0) {
      this.queues.delete(sessionId)
      this.ensureDrainScheduledIfNeeded()
      return
    }

    const batchSize = Math.min(this.eventBudgetPerSession, queue.length)
    for (let i = 0; i < batchSize; i++) {
      const ev = queue.shift()
      if (ev) this.handleUpdate(ev)
    }

    if (queue.length > 0) {
      this.activateSession(sessionId)
    } else {
      this.queues.delete(sessionId)
    }
    this.ensureDrainScheduledIfNeeded()
  }

  private ensureDrainScheduledIfNeeded(): void {
    if (this.activeSessionIds.length > 0) this.ensureDrainScheduled()
  }
}

function isCriticalUpdate(data: SessionUpdateData): boolean {
  if (data.permissionRequest || data.elicitationRequest || data.plan) return true
  if (data.eventType?.startsWith('lifecycle.')) return true
  if (data.eventType === 'permission.result' || data.eventType === 'elicitation.result') return true
  if (data.usage || data.configOptions || data.commands || data.sessionInfo) return true
  if (data.toolCallUpdate && isTerminalToolStatus(data.toolCallUpdate.status)) return true
  return false
}

function isTerminalToolStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'error' || status === 'cancelled'
}
