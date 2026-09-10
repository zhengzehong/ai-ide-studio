import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '../../ui/src/services/query-client'
import { wsClient } from '../../ui/src/services/ws-client'
import { loadTeamSession } from '../../ui/src/components/team/team-chat-loader'

afterEach(() => vi.restoreAllMocks())
describe('team history loading', () => {
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
