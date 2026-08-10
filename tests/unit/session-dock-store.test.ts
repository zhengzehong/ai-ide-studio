import { beforeEach, describe, expect, test, vi } from 'vitest'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => [] as unknown),
  on: vi.fn(() => () => undefined),
}))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { useSessionDockStore } = await import('../../ui/src/stores/session-dock.store.ts')

const item = {
  sessionId: 'session-1',
  sessionTitle: 'Core stability',
  stage: '',
  agentId: 'agent-1',
  agentName: 'Coder',
  agentIcon: 'code',
  agentAvatarUrl: null,
  projectId: 'project-1',
  projectName: 'AI IDE Studio',
  projectColor: '#2563eb',
  projectIcon: 'A',
  activityState: 'idle' as const,
  unread: true,
  lastActivityAt: '2026-08-05T06:00:00.000Z',
  sortOrder: 1,
  addedAt: '2026-08-05T05:00:00.000Z',
}

beforeEach(() => {
  wsMock.request.mockReset()
  wsMock.request.mockResolvedValue([])
  wsMock.on.mockClear()
  useSessionDockStore.setState({
    items: [],
    candidates: [],
    open: false,
    pickerOpen: false,
    loaded: false,
    loading: false,
    searching: false,
    query: '',
    error: null,
    searchError: null,
    adding: {},
    removing: {},
    reordering: false,
  })
})

describe('global Session dock store', () => {
  test('loads the lightweight dock read model', async () => {
    wsMock.request.mockResolvedValueOnce([item])

    await useSessionDockStore.getState().load()

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessionDock.list' })
    expect(useSessionDockStore.getState()).toMatchObject({ items: [item], loaded: true, loading: false })
  })

  test('adds a candidate without touching the project Session store', async () => {
    useSessionDockStore.setState({ candidates: [item] })
    wsMock.request.mockResolvedValueOnce(item)

    await useSessionDockStore.getState().add(item.sessionId)

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessionDock.add', sessionId: item.sessionId })
    expect(useSessionDockStore.getState()).toMatchObject({ items: [item], candidates: [], adding: {} })
  })

  test('does not let an older list response erase a successful pin', async () => {
    let resolveList: ((items: Array<typeof item>) => void) | undefined
    const pendingList = new Promise<Array<typeof item>>((resolve) => { resolveList = resolve })
    wsMock.request.mockReturnValueOnce(pendingList).mockResolvedValueOnce(item)

    const loading = useSessionDockStore.getState().load()
    await useSessionDockStore.getState().add(item.sessionId)
    expect(useSessionDockStore.getState().loading).toBe(false)
    resolveList?.([])
    await loading

    expect(useSessionDockStore.getState().items).toEqual([item])
  })

  test('rolls back an optimistic reorder when persistence fails', async () => {
    const second = { ...item, sessionId: 'session-2', sortOrder: 2 }
    useSessionDockStore.setState({ items: [item, second] })
    wsMock.request.mockRejectedValueOnce(new Error('save failed'))

    await useSessionDockStore.getState().reorder([second.sessionId, item.sessionId])

    expect(useSessionDockStore.getState()).toMatchObject({
      items: [item, second],
      reordering: false,
      error: 'save failed',
    })
  })

  test('refreshes for dock, relevant Session, and reconnect events', () => {
    useSessionDockStore.getState().setupListeners()

    expect(wsMock.on.mock.calls.map(([event]) => event)).toEqual([
      'session-dock:update',
      'session:activity',
      'session:done',
      'session:changed',
      'reconnected',
    ])
  })
})
