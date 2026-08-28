import type { SessionRecoveryQuery, SessionRecoverySnapshot } from '../ports/query-port.js'
import { eventStore, type SessionEventRow } from '../store/sessions.js'

export interface SessionRecoveryDiagnostics {
  operation: 'sessions.recovery'
  sessionId: string
  latestSequenceMs: number
  eventsMs: number
  totalMs: number
  eventCount: number
}

export interface SessionRecoveryReadResult {
  snapshot: SessionRecoverySnapshot
  diagnostics: SessionRecoveryDiagnostics
}

interface SessionRecoveryDependencies {
  latestSequence(sessionId: string): number
  listRecovery(sessionId: string, limit: number): SessionEventRow[]
  now(): number
}

const defaultDependencies: SessionRecoveryDependencies = {
  latestSequence: (sessionId) => eventStore.latestSequence(sessionId),
  listRecovery: (sessionId, limit) => eventStore.listRecovery(sessionId, limit),
  now: () => performance.now(),
}

export function readSessionRecovery(
  input: SessionRecoveryQuery & { limit: number },
  dependencies: SessionRecoveryDependencies = defaultDependencies,
): SessionRecoveryReadResult {
  const startedAt = dependencies.now()
  const latestSequence = dependencies.latestSequence(input.sessionId)
  const latestSequenceAt = dependencies.now()
  const events = dependencies.listRecovery(input.sessionId, input.limit)
  const completedAt = dependencies.now()
  return {
    snapshot: { sessionId: input.sessionId, latestSequence, events },
    diagnostics: {
      operation: 'sessions.recovery',
      sessionId: input.sessionId,
      latestSequenceMs: latestSequenceAt - startedAt,
      eventsMs: completedAt - latestSequenceAt,
      totalMs: completedAt - startedAt,
      eventCount: events.length,
    },
  }
}
