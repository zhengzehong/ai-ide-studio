import {
  isSessionUnreadByTimestamps,
  type SessionIndicatorStateMap,
} from '../utils/session-indicators'

type SessionReadState = 'read' | 'unread'

interface SessionReadTransition {
  revision: number
  state: SessionReadState
  readAt?: string
}

interface SessionReadRow {
  id: string
  last_message_at?: string | null
  last_read_at?: string | null
}

export interface SessionReadSnapshot<T> {
  sessions: T[]
  forcedUnreadSessionIds: SessionIndicatorStateMap
}

export interface SessionReadFence {
  checkpoint(): number
  recordRead(sessionId: string, readAt: string): void
  recordUnread(sessionId: string): void
  applySnapshot<T extends SessionReadRow>(sessions: T[], checkpoint: number): SessionReadSnapshot<T>
  remove(sessionId: string): void
}

export function createSessionReadFence(): SessionReadFence {
  let revision = 0
  const transitions = new Map<string, SessionReadTransition>()

  return {
    checkpoint: () => revision,
    recordRead: (sessionId, readAt) => {
      transitions.set(sessionId, { revision: ++revision, state: 'read', readAt })
    },
    recordUnread: (sessionId) => {
      transitions.set(sessionId, { revision: ++revision, state: 'unread' })
    },
    applySnapshot: (sessions, checkpoint) => {
      const forcedUnreadSessionIds: SessionIndicatorStateMap = {}
      const nextSessions = sessions.map((session) => {
        const transition = transitions.get(session.id)
        if (!transition) return session
        if (transition.state === 'unread') {
          if (transition.revision > checkpoint) forcedUnreadSessionIds[session.id] = true
          else transitions.delete(session.id)
          return session
        }

        const readAt = transition.readAt
        if (!readAt) return session
        const serverReadMs = timestampMs(session.last_read_at)
        const readMs = timestampMs(readAt)
        const messageMs = timestampMs(session.last_message_at)
        if (!readMs || (serverReadMs !== undefined && serverReadMs >= readMs)) {
          transitions.delete(session.id)
          return session
        }
        if (messageMs !== undefined && messageMs > readMs) {
          transitions.delete(session.id)
          return session
        }
        return session.last_read_at === readAt ? session : { ...session, last_read_at: readAt }
      })
      return { sessions: nextSessions, forcedUnreadSessionIds }
    },
    remove: (sessionId) => {
      transitions.delete(sessionId)
    },
  }
}

export function reconcileUnreadSessionIndicators<T extends SessionReadRow>(
  current: SessionIndicatorStateMap,
  sessions: T[],
  currentSessionId: string | null,
  runningSessionIds: SessionIndicatorStateMap,
  forcedUnreadSessionIds: SessionIndicatorStateMap = {},
): SessionIndicatorStateMap {
  const next = { ...current }
  for (const session of sessions) delete next[session.id]
  for (const session of sessions) {
    if (session.id === currentSessionId || runningSessionIds[session.id]) continue
    if (forcedUnreadSessionIds[session.id] || isSessionUnreadByTimestamps(session)) {
      next[session.id] = true
    }
  }
  return next
}

function timestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
