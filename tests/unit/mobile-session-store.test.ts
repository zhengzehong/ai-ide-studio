import { beforeEach, expect, test, vi } from 'vitest'
import { wsClient } from '@desktop/services/ws-client'
import { useAppStore } from '../../mobile/src/stores/app.store'
import { useSessionStore } from '../../mobile/src/stores/session.store'

beforeEach(() => {
  useAppStore.setState({
    projects: [{ id: 'project-a', name: 'Project A' }],
    agents: [{ id: 'agent-a', name: 'Agent A' }],
    currentProjectId: null,
  })
  useSessionStore.setState({
    sessions: [],
    loading: false,
    filterAgent: null,
    filterStatus: null,
    runningSessionIds: {},
    unreadSessionIds: {},
    currentSessionId: null,
  } as unknown as Parameters<typeof useSessionStore.setState>[0])
})

test('fetchSessions uses the main session list and maps project and agent labels', async () => {
  const request = vi.spyOn(wsClient, 'request').mockResolvedValue([
    {
      id: 'sess-a',
      agent_id: 'agent-a',
      task_id: null,
      acp_session_id: null,
      status: 'active',
      stage: '',
      started_at: '2026-06-10T00:00:00.000Z',
      updated_at: '2026-06-10T00:01:00.000Z',
      last_message_at: '2026-06-10T00:02:00.000Z',
      closed_at: null,
      project_id: 'project-a',
      title: 'Session A',
      activity_state: 'idle',
    },
  ])

  await useSessionStore.getState().fetchSessions('project-a')

  expect(request).toHaveBeenCalledWith({ type: 'sessions.list', projectId: 'project-a' })
  expect(useSessionStore.getState().sessions[0]).toMatchObject({
    id: 'sess-a',
    agentId: 'agent-a',
    agentName: 'Agent A',
    projectId: 'project-a',
    projectName: 'Project A',
    sessionTitle: 'Session A',
    unread: false,
  })

  request.mockRestore()
})

test('markRead clears local unread state without hiding or calling widget read state', async () => {
  const request = vi.spyOn(wsClient, 'request').mockResolvedValue([])
  useSessionStore.setState({
    sessions: [{
      id: 'sess-a',
      agentId: 'agent-a',
      agentName: 'Agent A',
      projectId: 'project-a',
      projectName: 'Project A',
      sessionTitle: 'Session A',
      status: 'active',
      activityState: 'idle',
      stage: '',
      unread: true,
      startedAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:01:00.000Z',
      lastMessageAt: '2026-06-10T00:02:00.000Z',
      closedAt: null,
    }],
    unreadSessionIds: { 'sess-a': true },
  } as unknown as Parameters<typeof useSessionStore.setState>[0])

  await useSessionStore.getState().markRead('sess-a')

  expect(request).not.toHaveBeenCalled()
  expect(useSessionStore.getState().sessions).toHaveLength(1)
  expect(useSessionStore.getState().sessions[0]).toMatchObject({ id: 'sess-a', unread: false })
  expect((useSessionStore.getState() as unknown as { unreadSessionIds: Record<string, true> }).unreadSessionIds['sess-a']).toBeUndefined()

  request.mockRestore()
})

test('session activity updates local running and unread indicators within the current project', async () => {
  useAppStore.getState().setCurrentProject('project-a')
  const request = vi.spyOn(wsClient, 'request').mockResolvedValue([])
  const handlers = new Map<string, (msg: Record<string, unknown>) => void>()
  const on = vi.spyOn(wsClient, 'on').mockImplementation((event, handler) => {
    handlers.set(event, handler)
    return () => handlers.delete(event)
  })
  useSessionStore.setState({
    sessions: [{
      id: 'sess-a',
      agentId: 'agent-a',
      agentName: 'Agent A',
      projectId: 'project-a',
      projectName: 'Project A',
      sessionTitle: 'Session A',
      status: 'active',
      activityState: 'idle',
      stage: '',
      unread: false,
      startedAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:01:00.000Z',
      lastMessageAt: '2026-06-10T00:02:00.000Z',
      closedAt: null,
    }],
  } as unknown as Parameters<typeof useSessionStore.setState>[0])

  const cleanup = useSessionStore.getState().setupListeners()
  handlers.get('session:activity')?.({ type: 'session:activity', sessionId: 'sess-a', state: 'running' })

  expect(useSessionStore.getState().sessions[0]).toMatchObject({ activityState: 'running', unread: false })
  expect((useSessionStore.getState() as unknown as { runningSessionIds: Record<string, true> }).runningSessionIds['sess-a']).toBe(true)

  handlers.get('session:activity')?.({ type: 'session:activity', sessionId: 'sess-a', state: 'idle' })

  expect(useSessionStore.getState().sessions[0]).toMatchObject({ activityState: 'idle', unread: true })
  expect((useSessionStore.getState() as unknown as { runningSessionIds: Record<string, true> }).runningSessionIds['sess-a']).toBeUndefined()
  expect((useSessionStore.getState() as unknown as { unreadSessionIds: Record<string, true> }).unreadSessionIds['sess-a']).toBe(true)
  await vi.waitFor(() => {
    expect(request).toHaveBeenCalledWith({ type: 'sessions.list', projectId: 'project-a' })
  })

  cleanup()
  request.mockRestore()
  on.mockRestore()
})
