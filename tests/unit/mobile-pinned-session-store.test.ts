import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { wsClient } from '@desktop/services/ws-client'
import { usePinnedSessionStore } from '../../mobile/src/stores/pinned-session.store'

const item = {
  sessionId: 'session-1',
  sessionTitle: '发布前检查',
  stage: '',
  agentId: 'agent-1',
  agentName: '编码智能体',
  projectId: 'project-1',
  projectName: 'AI IDE Studio',
  projectColor: null,
  projectIcon: null,
  activityState: 'idle' as const,
  unread: true,
  lastActivityAt: '2026-08-10T06:00:00.000Z',
  sortOrder: 1,
  addedAt: '2026-08-10T05:00:00.000Z',
}

beforeEach(() => {
  usePinnedSessionStore.setState({
    items: [],
    loading: false,
    loaded: false,
    error: null,
    removing: {},
    reordering: false,
  })
})

afterEach(() => vi.restoreAllMocks())

describe('mobile pinned session store', () => {
  test('loads the shared session dock read model', async () => {
    const request = vi.spyOn(wsClient, 'request').mockResolvedValue([item])

    await usePinnedSessionStore.getState().load()

    expect(request).toHaveBeenCalledWith({ type: 'sessionDock.list' })
    expect(usePinnedSessionStore.getState()).toMatchObject({ items: [item], loaded: true, loading: false })
  })

  test('adds and removes a pinned session without changing the normal session store', async () => {
    const request = vi.spyOn(wsClient, 'request')
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce({ removed: true })

    await usePinnedSessionStore.getState().add(item.sessionId)
    expect(usePinnedSessionStore.getState().isPinned(item.sessionId)).toBe(true)
    await usePinnedSessionStore.getState().remove(item.sessionId)

    expect(request).toHaveBeenNthCalledWith(1, { type: 'sessionDock.add', sessionId: item.sessionId })
    expect(request).toHaveBeenNthCalledWith(2, { type: 'sessionDock.remove', sessionId: item.sessionId })
    expect(usePinnedSessionStore.getState().items).toEqual([])
  })

  test('does not let an older list response erase a successful pin', async () => {
    let resolveList: ((items: Array<typeof item>) => void) | undefined
    const pendingList = new Promise<Array<typeof item>>((resolve) => { resolveList = resolve })
    const request = vi.spyOn(wsClient, 'request')
      .mockReturnValueOnce(pendingList)
      .mockResolvedValueOnce(item)

    const loading = usePinnedSessionStore.getState().load()
    await usePinnedSessionStore.getState().add(item.sessionId)
    resolveList?.([])
    await loading

    expect(request).toHaveBeenNthCalledWith(1, { type: 'sessionDock.list' })
    expect(usePinnedSessionStore.getState().items).toEqual([item])
  })

  test('does not let an older list response restore an unread indicator', async () => {
    usePinnedSessionStore.setState({ items: [item] })
    let resolveList: ((items: Array<typeof item>) => void) | undefined
    const pendingList = new Promise<Array<typeof item>>((resolve) => { resolveList = resolve })
    vi.spyOn(wsClient, 'request')
      .mockReturnValueOnce(pendingList)
      .mockResolvedValueOnce({ ok: true })

    const loading = usePinnedSessionStore.getState().load()
    await usePinnedSessionStore.getState().markRead(item.sessionId)
    resolveList?.([item])
    await loading

    expect(usePinnedSessionStore.getState().items[0]?.unread).toBe(false)
  })

  test('optimistically marks a pinned session read and rolls back reorder on failure', async () => {
    usePinnedSessionStore.setState({ items: [item, { ...item, sessionId: 'session-2', sortOrder: 2 }] })
    const request = vi.spyOn(wsClient, 'request')
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('排序失败'))

    await usePinnedSessionStore.getState().markRead(item.sessionId)
    expect(usePinnedSessionStore.getState().items[0]?.unread).toBe(false)
    await usePinnedSessionStore.getState().reorder(['session-2', item.sessionId])

    expect(usePinnedSessionStore.getState().items.map((entry) => entry.sessionId)).toEqual(['session-1', 'session-2'])
    expect(usePinnedSessionStore.getState().error).toBe('排序失败')
  })
})
