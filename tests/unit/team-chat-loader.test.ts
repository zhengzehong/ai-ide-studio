import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '../../ui/src/services/query-client'
import { wsClient } from '../../ui/src/services/ws-client'
import { loadTeamSession, loadTeamMessagePage } from '../../ui/src/components/team/team-chat-loader'

afterEach(() => vi.restoreAllMocks())
describe('team history loading', () => {
  it('refreshes a completed member with a small message page and no replay queries', async () => {
    const recovery = vi.spyOn(queryClient, 'getSessionRecovery')
    const list = vi.spyOn(queryClient, 'listSessionMessages').mockResolvedValue({ items: [], hasMore: false, nextCursor: null })
    const rpc = vi.spyOn(wsClient, 'request')
    await loadTeamMessagePage('refresh', 'worker-a', 'master', 'Worker A', 'member')
    expect(list).toHaveBeenCalledExactlyOnceWith({ sessionId: 'worker-a', limit: 20, includeToolCalls: false, includeLatestToolCalls: false })
    expect(recovery).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('loads history without discovering or starting member runtimes', async () => {
    vi.spyOn(queryClient, 'getSessionRecovery').mockResolvedValue({ sessionId: 's', latestSequence: 4, events: [] })
    vi.spyOn(queryClient, 'listSessionMessages').mockResolvedValue({ items: [], hasMore: false, nextCursor: null })
    const rpc = vi.spyOn(wsClient, 'request')
    const first = loadTeamSession('view-1', 's', 'master', 'Worker', 'member')
    const second = loadTeamSession('view-1', 's', 'master', 'Worker', 'member')
    expect(first).toBe(second)
    const loaded = await first
    expect(loaded.snapshot.sessionId).toBe('s')
    expect(rpc).not.toHaveBeenCalled()
    expect(queryClient.listSessionMessages).toHaveBeenCalledTimes(1)
    await loadTeamSession('view-2', 's', 'master', 'Worker', 'member')
    expect(queryClient.listSessionMessages).toHaveBeenCalledTimes(2)
  })
})
