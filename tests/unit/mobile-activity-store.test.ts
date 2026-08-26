import { beforeEach, describe, expect, test, vi } from 'vitest'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => ({ ok: true })),
  on: vi.fn(() => () => undefined),
}))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { useMobileActivityStore } = await import('../../mobile/src/stores/activity.store')

const group = {
  groupId: 'agent-1:project-1',
  agentId: 'agent-1',
  agentName: '编码智能体',
  agentIcon: null,
  projectId: 'project-1',
  projectName: 'AI IDE Studio',
  activityAt: '2026-08-26T08:02:00.000Z',
  sessions: [
    {
      sessionId: 'session-unread',
      taskId: 'task-1',
      taskTitle: '修复导航',
      taskStatus: 'completed',
      sessionTitle: '未读会话',
      status: 'active',
      stage: '',
      running: false,
      unread: true,
      attentionState: 'unread' as const,
      activityAt: '2026-08-26T08:02:00.000Z',
    },
    {
      sessionId: 'session-running',
      taskId: null,
      taskTitle: null,
      taskStatus: null,
      sessionTitle: '运行会话',
      status: 'active',
      stage: '正在编码',
      running: true,
      unread: true,
      attentionState: 'running' as const,
      activityAt: '2026-08-26T08:01:00.000Z',
    },
  ],
}

beforeEach(() => {
  wsMock.request.mockReset()
  wsMock.request.mockResolvedValue({ ok: true })
  wsMock.on.mockClear()
  useMobileActivityStore.setState({ groups: [], loading: false, loaded: false, error: null })
})

describe('mobile activity store', () => {
  test('loads all-project running and unread activity through the existing widget query', async () => {
    wsMock.request.mockResolvedValueOnce([group])

    await useMobileActivityStore.getState().load()

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'widget.sessionActivity.list' })
    expect(useMobileActivityStore.getState()).toMatchObject({ groups: [group], loaded: true, loading: false })
  })

  test('removes an opened unread session but keeps an opened running session', async () => {
    useMobileActivityStore.setState({ groups: [group], loaded: true })

    await useMobileActivityStore.getState().markRead('session-unread')
    expect(wsMock.request).toHaveBeenNthCalledWith(1, { type: 'sessions.markRead', sessionId: 'session-unread' })
    expect(useMobileActivityStore.getState().groups[0]?.sessions.map((item) => item.sessionId))
      .toEqual(['session-running'])

    await useMobileActivityStore.getState().markRead('session-running')
    expect(useMobileActivityStore.getState().groups[0]?.sessions[0]).toMatchObject({
      sessionId: 'session-running',
      running: true,
      unread: false,
    })
  })

  test('refreshes for lifecycle changes and reconnects', () => {
    useMobileActivityStore.getState().setupListeners()

    expect(wsMock.on.mock.calls.map(([event]) => event)).toEqual([
      'session:activity',
      'session:done',
      'session:changed',
      'task:update',
      'reconnected',
    ])
  })
})
