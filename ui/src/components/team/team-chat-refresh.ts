import { emptySnapshot, mergeLoadedSnapshots, type Snapshot } from './team-chat-state'

export class TeamRecoveryGate {
  private requested = 0
  private acknowledged = 0
  get version(): number { return this.requested }
  get pending(): boolean { return this.requested !== this.acknowledged }
  request(): void { this.requested++ }
  complete(version: number): boolean {
    if (!this.pending || version !== this.requested) return false
    this.acknowledged = version
    return true
  }
}

export function mergeTeamMessageRefresh(current: Record<string, Snapshot>, sessionId: string, page: Snapshot): Record<string, Snapshot> {
  const previous = current[sessionId] || emptySnapshot(sessionId)
  const next = mergeLoadedSnapshots(current, { [sessionId]: {
    ...previous, messages: page.messages, hasMore: previous.hasMore || page.hasMore,
    // A message page has no event cursor and must not replace live recovery state.
    replaySequence: undefined,
  } })
  next[sessionId] = { ...next[sessionId], replaySequence: previous.replaySequence }
  return next
}

export async function runTeamLoads(ids: string[], operation: (id: string) => Promise<void>): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = new Array(ids.length)
  let index = 0
  const worker = async (): Promise<void> => {
    while (index < ids.length) {
      const current = index++
      try { await operation(ids[current]); results[current] = { status: 'fulfilled', value: undefined } }
      catch (reason) { results[current] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, ids.length) }, worker))
  return results
}
