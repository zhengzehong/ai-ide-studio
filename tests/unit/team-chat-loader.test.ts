import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '../../ui/src/services/query-client'
import { wsClient } from '../../ui/src/services/ws-client'
import { loadTeamSessionBase, loadTeamMessagePage } from '../../ui/src/components/team/team-chat-loader'

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
    // P1:恢复边界改由轻端点提供(每成员一次,只回 latestSequence + usage + 未决项)
    const rpc = vi.spyOn(wsClient, 'request').mockResolvedValue({
      sessionId: 's',
      latestSequence: 4,
      usage: null,
      pendingPermissions: [],
      pendingElicitations: [],
    })
    vi.spyOn(queryClient, 'listSessionMessages').mockResolvedValue({ items: [], hasMore: false, nextCursor: null })
    const first = loadTeamSessionBase('view-1', 's', 'master', 'Worker', 'member')
    const second = loadTeamSessionBase('view-1', 's', 'master', 'Worker', 'member')
    expect(first).toBe(second)
    const loaded = await first
    expect(loaded.snapshot.sessionId).toBe('s')
    expect(loaded.snapshot.replaySequence).toBe(4)
    // 无运行中回合:不产生重放计划,也不发任何回合重放请求
    expect(loaded.replay).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith({ type: 'sessions.teamMemberState', sessionId: 's' })
    expect(queryClient.listSessionMessages).toHaveBeenCalledTimes(1)
    await loadTeamSessionBase('view-2', 's', 'master', 'Worker', 'member')
    expect(queryClient.listSessionMessages).toHaveBeenCalledTimes(2)
  })

  it('keeps the pending interactions and usage provided by the light endpoint', async () => {
    vi.spyOn(wsClient, 'request').mockResolvedValue({
      sessionId: 's',
      latestSequence: 9,
      usage: { contextSize: 200000, contextUsed: 12345 },
      pendingPermissions: [{ id: 'perm-1', toolCall: {}, options: [] }],
      pendingElicitations: [],
    })
    vi.spyOn(queryClient, 'listSessionMessages').mockResolvedValue({ items: [], hasMore: false, nextCursor: null })

    const loaded = await loadTeamSessionBase('view-light', 's', 'master', 'Worker', 'member')

    expect(loaded.snapshot.permissions).toEqual([expect.objectContaining({ id: 'perm-1' })])
    expect(loaded.snapshot.usage).toEqual({ contextSize: 200000, contextUsed: 12345 })
    expect(loaded.snapshot.events).toEqual([])
  })
})
