import type { TeamRecoveryGate } from './team-chat-refresh'

interface RecoveryOptions {
  client: {
    on(type: string, listener: (message: Record<string, unknown>) => void): () => void
    acknowledgeResync(sessionId?: string): void
  }
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
  sessionIds: Set<string>
  gate: TeamRecoveryGate
  load(): Promise<boolean>
}

export function subscribeTeamRecovery({ client, document, sessionIds, gate, load }: RecoveryOptions): () => void {
  let active = true
  const off = client.on('resync_required', message => {
    const sessionId = typeof message.sessionId === 'string' ? message.sessionId : undefined
    if (sessionId && !sessionIds.has(sessionId)) return
    gate.request()
    // Resume before loading; snapshot replay retains events arriving after the
    // recovery boundary. A gap during an older load requires one more snapshot.
    client.acknowledgeResync(sessionId)
    void load().then(loaded => { if (active && loaded && gate.pending) void load() })
  })
  const visible = (): void => { if (document.visibilityState === 'visible') void load() }
  document.addEventListener('visibilitychange', visible)
  return (): void => { active = false; off(); document.removeEventListener('visibilitychange', visible) }
}
