import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WidgetAgentProjectActivityGroup } from '../../ui/src/stores/widget.store.ts'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => ({ ok: true })),
  on: vi.fn(() => () => undefined),
}))

vi.mock('../../ui/src/services/ws-client', () => ({
  wsClient: wsMock,
}))

const { useWidgetStore } = await import('../../ui/src/stores/widget.store.ts')

const activityGroup = {
  groupId: 'agent-1:project-1',
  agentId: 'agent-1',
  agentName: 'Codex',
  agentIcon: null,
  projectId: 'project-1',
  projectName: 'Project',
  activityAt: '2026-08-03T00:00:02.000Z',
  sessions: [
    {
      sessionId: 'session-unread',
      taskId: 'task-1',
      taskTitle: 'Fix issue',
      taskStatus: 'completed',
      sessionTitle: 'Unread Session',
      status: 'active',
      stage: '',
      running: false,
      unread: true,
      attentionState: 'unread' as const,
      activityAt: '2026-08-03T00:00:02.000Z',
    },
    {
      sessionId: 'session-running',
      taskId: null,
      taskTitle: null,
      taskStatus: null,
      sessionTitle: 'Running Session',
      status: 'active',
      stage: '',
      running: true,
      unread: false,
      attentionState: 'running' as const,
      activityAt: '2026-08-03T00:00:01.000Z',
    },
  ],
}

beforeEach(() => {
  wsMock.request.mockReset()
  wsMock.request.mockResolvedValue({ ok: true })
  wsMock.on.mockClear()
  useWidgetStore.setState({
    activityGroups: [],
    activitiesLoading: false,
    activitiesError: null,
    preferences: { pinnedProjectId: null, pinnedAgentId: null },
    preferencesLoaded: false,
  })
})
describe('widget store', () => {
  test('loads the grouped Session activity read model', async () => {
    wsMock.request.mockResolvedValueOnce([activityGroup])

    await useWidgetStore.getState().fetchActivities('project-1')

    expect(wsMock.request).toHaveBeenCalledWith({
      type: 'widget.sessionActivity.list',
      projectId: 'project-1',
    })
    expect(useWidgetStore.getState()).toMatchObject({
      activityGroups: [{ agentId: 'agent-1', sessions: [{ sessionId: 'session-unread' }, { sessionId: 'session-running' }] }],
      activitiesLoading: false,
      activitiesError: null,
    })
  })

  test('removes only the read-only Session after opening it', async () => {
    useWidgetStore.setState({ activityGroups: [activityGroup] })

    await useWidgetStore.getState().markSessionRead('session-unread')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'widget.sessions.markRead', sessionId: 'session-unread' })
    expect(useWidgetStore.getState().activityGroups).toMatchObject([{
      agentId: 'agent-1',
      sessions: [{ sessionId: 'session-running', running: true }],
    }])
  })

  test('keeps a running Session after clearing its unread flag', async () => {
    useWidgetStore.setState({
      activityGroups: [{
        ...activityGroup,
        sessions: [{ ...activityGroup.sessions[1]!, unread: true }],
      }],
    })

    await useWidgetStore.getState().markSessionRead('session-running')

    expect(useWidgetStore.getState().activityGroups[0]?.sessions[0]).toMatchObject({
      sessionId: 'session-running',
      running: true,
      unread: false,
    })
  })

  test('exposes a retryable error when activity synchronization fails', async () => {
    wsMock.request.mockRejectedValueOnce(new Error('network unavailable'))

    await useWidgetStore.getState().fetchActivities('project-1')

    expect(useWidgetStore.getState()).toMatchObject({
      activitiesLoading: false,
      activitiesError: 'network unavailable',
    })
  })

  test('refreshes activity for Session, Agent, and Task changes', () => {
    const cleanup = useWidgetStore.getState().setupListeners()

    expect(wsMock.on.mock.calls.map(([event]) => event)).toEqual([
      'agent:status',
      'session:activity',
      'session:done',
      'session:changed',
      'task:update',
    ])
    cleanup()
  })

  test('coalesces a burst of realtime events into one activity request', async () => {
    vi.useFakeTimers()
    wsMock.request.mockResolvedValueOnce([activityGroup])
    const cleanup = useWidgetStore.getState().setupListeners()
    const listeners = wsMock.on.mock.calls.map(([, listener]) => listener as () => void)

    listeners.forEach((listener) => listener())
    await vi.advanceTimersByTimeAsync(149)
    expect(wsMock.request).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(wsMock.request).toHaveBeenCalledTimes(1)
    cleanup()
    vi.useRealTimers()
  })

  test('runs one follow-up when events arrive during an activity request', async () => {
    vi.useFakeTimers()
    let resolveFirst: ((value: WidgetAgentProjectActivityGroup[]) => void) | undefined
    wsMock.request
      .mockImplementationOnce(() => new Promise((resolveRequest) => {
        resolveFirst = resolveRequest
      }))
      .mockResolvedValueOnce([activityGroup])
    const cleanup = useWidgetStore.getState().setupListeners()
    const listener = wsMock.on.mock.calls[0]?.[1] as () => void

    listener()
    await vi.advanceTimersByTimeAsync(150)
    listener()
    listener()
    await vi.advanceTimersByTimeAsync(150)
    expect(wsMock.request).toHaveBeenCalledTimes(1)

    resolveFirst?.([activityGroup])
    await vi.waitFor(() => expect(wsMock.request).toHaveBeenCalledTimes(2))

    cleanup()
    vi.useRealTimers()
  })

  test('cancels a scheduled activity refresh when listeners are removed', async () => {
    vi.useFakeTimers()
    const cleanup = useWidgetStore.getState().setupListeners()
    const listener = wsMock.on.mock.calls[0]?.[1] as () => void

    listener()
    cleanup()
    await vi.advanceTimersByTimeAsync(150)

    expect(wsMock.request).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
