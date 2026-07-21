interface SessionCancelCommand {
  commandId: string
  type: 'session.cancel'
  sessionId: string
}

interface CancelInput {
  sessionId: string
  turnId?: string
  onStart: () => void
  onFailure: (error: unknown) => void
}

interface CancelEntry {
  promise: Promise<void>
}

export interface SessionCancelCoordinator {
  cancel: (input: CancelInput) => Promise<void>
  pending: (sessionId: string) => Promise<void> | undefined
  clear: (sessionId: string) => void
}

export function createSessionCancelCoordinator(
  execute: (command: SessionCancelCommand) => Promise<unknown>,
): SessionCancelCoordinator {
  const active = new Map<string, CancelEntry>()
  const attemptsByTurn = new Map<string, number>()
  const turnBySession = new Map<string, string>()

  return {
    cancel(input) {
      const existing = active.get(input.sessionId)
      if (existing) return existing.promise

      const turnKey = `${input.sessionId}:${input.turnId || 'active-turn'}`
      const attempt = (attemptsByTurn.get(turnKey) ?? 0) + 1
      attemptsByTurn.set(turnKey, attempt)
      turnBySession.set(input.sessionId, turnKey)
      input.onStart()

      let execution: Promise<unknown>
      try {
        execution = execute({
          commandId: buildCancelCommandId(input.sessionId, input.turnId, attempt),
          type: 'session.cancel',
          sessionId: input.sessionId,
        })
      } catch (error) {
        input.onFailure(error)
        return Promise.reject(error)
      }

      const entry: CancelEntry = { promise: Promise.resolve() }
      const promise = execution
        .then(() => undefined)
        .catch((error: unknown) => {
          if (active.get(input.sessionId) === entry) input.onFailure(error)
          throw error
        })
        .finally(() => {
          if (active.get(input.sessionId) === entry) active.delete(input.sessionId)
        })
      entry.promise = promise
      active.set(input.sessionId, entry)
      return promise
    },

    pending(sessionId) {
      return active.get(sessionId)?.promise
    },

    clear(sessionId) {
      active.delete(sessionId)
      const turnKey = turnBySession.get(sessionId)
      if (turnKey) attemptsByTurn.delete(turnKey)
      turnBySession.delete(sessionId)
    },
  }
}

function buildCancelCommandId(sessionId: string, turnId: string | undefined, attempt: number): string {
  return `cmd-cancel-${commandPart(sessionId)}-${commandPart(turnId || 'active-turn')}-${attempt}`
}

function commandPart(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._:-]/g, '-')
  if (normalized.length <= 72) return normalized
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${normalized.slice(0, 56)}-${(hash >>> 0).toString(36)}`
}
