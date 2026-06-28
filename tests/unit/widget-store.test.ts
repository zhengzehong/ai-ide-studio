import { beforeEach, describe, expect, test, vi } from 'vitest'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => ({ ok: true })),
  on: vi.fn(() => () => undefined),
}))

vi.mock('../../ui/src/services/ws-client', () => ({
  wsClient: wsMock,
}))

const { useWidgetStore } = await import('../../ui/src/stores/widget.store.ts')

beforeEach(() => {
  wsMock.request.mockReset()
  wsMock.request.mockResolvedValue({ ok: true })
  useWidgetStore.setState({
    sessions: [],
    sessionsLoading: false,
    preferences: { pinnedProjectId: null, pinnedAgentId: null },
    preferencesLoaded: false,
  })
})

describe('widget store', () => {
  test('removes an idle unread session from the active list after marking it read', async () => {
    useWidgetStore.setState({
      sessions: [
        {
          sessionId: 'sess-unread',
          agentId: 'agent-1',
          agentName: 'Codex',
          agentIcon: null,
          projectId: 'proj-1',
          projectName: 'Project',
          taskId: null,
          taskTitle: null,
          sessionTitle: 'Fix issue',
          status: 'active',
          activityState: 'idle',
          stage: '',
          unread: true,
          startedAt: '2026-06-08T00:00:00.000Z',
          lastMessageAt: '2026-06-08T00:00:01.000Z',
          completedAt: '2026-06-08T00:00:01.000Z',
          closedAt: null,
        },
      ],
    })

    await useWidgetStore.getState().markSessionRead('sess-unread')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'widget.sessions.markRead', sessionId: 'sess-unread' })
    expect(useWidgetStore.getState().sessions).toEqual([])
  })

  test('keeps a running session visible after marking it read', async () => {
    useWidgetStore.setState({
      sessions: [
        {
          sessionId: 'sess-running',
          agentId: 'agent-1',
          agentName: 'Codex',
          agentIcon: null,
          projectId: 'proj-1',
          projectName: 'Project',
          taskId: null,
          taskTitle: null,
          sessionTitle: 'Run task',
          status: 'active',
          activityState: 'running',
          stage: '正在执行...',
          unread: true,
          startedAt: '2026-06-08T00:00:00.000Z',
          lastMessageAt: null,
          completedAt: null,
          closedAt: null,
        },
      ],
    })

    await useWidgetStore.getState().markSessionRead('sess-running')

    expect(useWidgetStore.getState().sessions).toMatchObject([
      { sessionId: 'sess-running', activityState: 'running', unread: false },
    ])
  })
})
