import { describe, expect, it, vi } from 'vitest'
import { emptySnapshot } from '../../ui/src/components/team/team-chat-state'
import { normalizeMessage } from '../../ui/src/stores/session-events'
import { mergeTeamMessageRefresh, runTeamLoads, TeamRecoveryGate } from '../../ui/src/components/team/team-chat-refresh'

describe('team incremental refresh', () => {
  it('does not acknowledge a new gap using a snapshot already loading before the gap', () => {
    const recovery = new TeamRecoveryGate()
    const staleVersion = recovery.version
    recovery.request()
    expect(recovery.complete(staleVersion)).toBe(false)
    expect(recovery.pending).toBe(true)
    const currentVersion = recovery.version
    expect(recovery.complete(currentVersion)).toBe(true)
    expect(recovery.complete(currentVersion)).toBe(false)
    expect(recovery.pending).toBe(false)
  })
  it('keeps completed content and other members when one member returns stale history', () => {
    const completed = normalizeMessage({ id: 'a:reply', session_id: 'master', role: 'agent', content: 'kept', status: 'completed', timestamp: '2026-09-12' })
    const first = { ...emptySnapshot('a'), messages: [completed], hasMore: true }
    const second = emptySnapshot('b')
    const next = mergeTeamMessageRefresh({ a: first, b: second }, 'a', { ...emptySnapshot('a'), messages: [{ ...completed, content: '', status: 'running' }] })
    expect(next.a.messages[0]).toMatchObject({ content: 'kept', status: 'completed' })
    expect(next.a.hasMore).toBe(true)
    expect(next.b).toBe(second)
  })

  it('bounds concurrent member queries and finishes other members after a failure', async () => {
    let active = 0
    let maximum = 0
    const releases: Array<() => void> = []
    const operation = vi.fn(async (id: string): Promise<void> => {
      active++
      maximum = Math.max(active, maximum)
      await new Promise<void>(resolve => releases.push(resolve))
      active--
      if (id === 'b') throw new Error('failed member')
    })
    const result = runTeamLoads(['a', 'b', 'c'], operation)
    expect(operation).toHaveBeenCalledTimes(2)
    releases.splice(0).forEach(release => release())
    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(3))
    releases.splice(0).forEach(release => release())
    expect((await result).map(item => item.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect(maximum).toBe(2)
  })
})
