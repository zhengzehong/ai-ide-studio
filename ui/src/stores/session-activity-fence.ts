export type SessionActivityState = 'running' | 'idle'

interface SessionActivityTransition {
  revision: number
  state: SessionActivityState
}

export interface SessionActivityFence {
  checkpoint(): number
  record(sessionId: string, state: SessionActivityState): void
  applyNewer<T extends { id: string; activity_state?: SessionActivityState }>(
    sessions: T[],
    checkpoint: number,
  ): T[]
  remove(sessionId: string): void
}

export function createSessionActivityFence(): SessionActivityFence {
  let revision = 0
  const transitions = new Map<string, SessionActivityTransition>()

  return {
    checkpoint: () => revision,
    record: (sessionId, state) => {
      transitions.set(sessionId, { revision: ++revision, state })
    },
    applyNewer: (sessions, checkpoint) => sessions.map((session) => {
      const transition = transitions.get(session.id)
      if (!transition || transition.revision <= checkpoint || session.activity_state === transition.state) {
        return session
      }
      return { ...session, activity_state: transition.state }
    }),
    remove: (sessionId) => {
      transitions.delete(sessionId)
    },
  }
}
