import { beforeEach, describe, expect, test, vi } from 'vitest'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => ({ ok: true })),
  on: vi.fn(() => () => undefined),
}))

vi.mock('../../ui/src/services/ws-client', () => ({
  wsClient: wsMock,
}))

const { useWidgetStore } = await import('../../ui/src/stores/widget.store.ts')

const activity = {
  sessionId: 'sess-unread',
  agentId: 'agent-1',
  agentName: 'Codex',
  agentIcon: null,
  projectId: 'proj-1',
  projectName: 'Project',
  taskId: 'task-1',
  taskTitle: 'Fix issue',
  taskStatus: 'running',
  sessionTitle: 'Session title',
  status: 'active',
  activityState: 'idle' as const,
  stage: '',
  unread: true,
  unreadCount: 2,
  startedAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:01.000Z',
  lastMessageAt: '2026-06-08T00:00:01.000Z',
  completedAt: '2026-06-08T00:00:01.000Z',
  closedAt: null,
  activityAt: '2026-06-08T00:00:01.000Z',
}

beforeEach(() => {
  wsMock.request.mockReset()
  wsMock.request.mockResolvedValue({ ok: true })
  wsMock.on.mockClear()
  useWidgetStore.setState({
    activities: [],
    activitiesLoading: false,
    activitiesError: null,
    preferences: { pinnedProjectId: null, pinnedAgentId: null },
    preferencesLoaded: false,
  })
})

describe('widget store', () => {
  test('loads the Agent activity read model', async () => {
    wsMock.request.mockResolvedValueOnce([activity])

    await useWidgetStore.getState().fetchActivities('proj-1')

    expect(wsMock.request).toHaveBeenCalledWith({
      type: 'widget.agentActivity.list',
      projectId: 'proj-1',
    })
    expect(useWidgetStore.getState()).toMatchObject({
      activities: [{ agentId: 'agent-1', taskTitle: 'Fix issue' }],
      activitiesLoading: false,
      activitiesError: null,
    })
  })

  test('keeps the Agent row after marking its representative Session read', async () => {
    useWidgetStore.setState({ activities: [activity] })

    await useWidgetStore.getState().markSessionRead('sess-unread')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'widget.sessions.markRead', sessionId: 'sess-unread' })
    expect(useWidgetStore.getState().activities).toMatchObject([
      { agentId: 'agent-1', unread: false, unreadCount: 1 },
    ])
  })

  test('exposes a retryable error when Agent activity synchronization fails', async () => {
    wsMock.request.mockRejectedValueOnce(new Error('network unavailable'))

    await useWidgetStore.getState().fetchActivities('project-1')

    expect(useWidgetStore.getState()).toMatchObject({
      activitiesLoading: false,
      activitiesError: 'network unavailable',
    })
  })

  test('refreshes activity for Session, Agent, and Task changes', () => {
    useWidgetStore.getState().setupListeners()

    expect(wsMock.on.mock.calls.map(([event]) => event)).toEqual([
      'agent:status',
      'session:activity',
      'session:done',
      'session:changed',
      'task:update',
    ])
  })
})
