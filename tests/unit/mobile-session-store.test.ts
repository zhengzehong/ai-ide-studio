import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { wsClient } from '@desktop/services/ws-client'
import { useAppStore } from '../../mobile/src/stores/app.store'
import { useSessionStore } from '../../mobile/src/stores/session.store'

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-a',
    agent_id: 'agent-a',
    task_id: null,
    acp_session_id: null,
    status: 'active',
    stage: '',
    started_at: '2026-06-10T00:00:00.000Z',
    updated_at: '2026-06-10T00:01:00.000Z',
    last_message_at: '2026-06-10T00:02:00.000Z',
    last_read_at: '2026-06-10T00:02:00.000Z',
    closed_at: null,
    project_id: 'project-a',
    title: 'Session A',
    activity_state: 'idle',
    ...overrides,
  }
}

beforeEach(() => {
  useAppStore.setState({
    projects: [
      { id: 'project-a', name: 'Project A' },
      { id: 'project-b', name: 'Project B' },
    ],
    agents: [{ id: 'agent-a', name: 'Agent A' }],
    currentProjectId: null,
  })
  useSessionStore.setState({
    sessions: [],
    loading: false,
    filterAgent: null,
    filterStatus: null,
    runningSessionIds: {},
    currentSessionId: null,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('fetchSessions uses the main session list and maps project and agent labels', async () => {
  const request = vi.spyOn(wsClient, 'request').mockResolvedValue([sessionRow()])

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
})

test('fetchSessions computes unread from last_message_at > last_read_at', async () => {
  vi.spyOn(wsClient, 'request').mockResolvedValue([
    sessionRow({ id: 'sess-a', last_message_at: '2026-06-10T00:03:00.000Z', last_read_at: '2026-06-10T00:02:00.000Z' }),
    sessionRow({ id: 'sess-b', last_message_at: '2026-06-10T00:02:00.000Z', last_read_at: '2026-06-10T00:02:00.000Z' }),
    sessionRow({ id: 'sess-c', last_message_at: '2026-06-10T00:02:00.000Z', last_read_at: null }),
  ])

  await useSessionStore.getState().fetchSessions('project-a')

  const sessions = useSessionStore.getState().sessions
  expect(sessions.find((s) => s.id === 'sess-a')?.unread).toBe(true)
  expect(sessions.find((s) => s.id === 'sess-b')?.unread).toBe(false)
  expect(sessions.find((s) => s.id === 'sess-c')?.unread).toBe(true)
})

test('all-project fetch preserves running indicators for sessions not in the returned set', async () => {
  vi.spyOn(wsClient, 'request').mockResolvedValue([sessionRow()])
  useSessionStore.setState({
    runningSessionIds: { 'sess-b': true },
  })

  await useSessionStore.getState().fetchSessions(null)

  // sess-b isn't in the returned list; preserveMissing=false for all-project fetch,
  // so its running indicator is pruned.
  expect(useSessionStore.getState().runningSessionIds['sess-b']).toBeUndefined()
})

test('project-scoped fetch preserves running indicators outside the current project', async () => {
  vi.spyOn(wsClient, 'request').mockResolvedValue([sessionRow()])
  useSessionStore.setState({
    runningSessionIds: { 'sess-b': true },
  })

  await useSessionStore.getState().fetchSessions('project-a')

  expect(useSessionStore.getState().runningSessionIds['sess-b']).toBe(true)
})

test('fetching a running session clears its running indicator only when the server reports idle', async () => {
  vi.spyOn(wsClient, 'request').mockResolvedValue([sessionRow({ activity_state: 'running' })])
  useSessionStore.setState({
    runningSessionIds: { 'sess-a': true, 'sess-b': true },
  })

  await useSessionStore.getState().fetchSessions('project-a')

  expect(useSessionStore.getState().runningSessionIds['sess-a']).toBe(true)
  expect(useSessionStore.getState().runningSessionIds['sess-b']).toBe(true)
})

test('markRead updates local unread state and persists via sessions.markRead RPC', async () => {
  const request = vi.spyOn(wsClient, 'request').mockResolvedValue({ ok: true })
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
      lastReadAt: '2026-06-10T00:01:00.000Z',
      closedAt: null,
    }],
  })

  await useSessionStore.getState().markRead('sess-a')

  expect(request).toHaveBeenCalledWith({ type: 'sessions.markRead', sessionId: 'sess-a' })
  expect(useSessionStore.getState().sessions).toHaveLength(1)
  expect(useSessionStore.getState().sessions[0]).toMatchObject({ id: 'sess-a', unread: false })
  expect(useSessionStore.getState().sessions[0].lastReadAt).toBeTruthy()
})

test('markRead keeps local state correct even when the RPC fails', async () => {
  const request = vi.spyOn(wsClient, 'request').mockRejectedValue(new Error('network'))
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
      lastReadAt: '2026-06-10T00:01:00.000Z',
      closedAt: null,
    }],
  })

  await useSessionStore.getState().markRead('sess-a')

  expect(request).toHaveBeenCalled()
  expect(useSessionStore.getState().sessions[0]).toMatchObject({ id: 'sess-a', unread: false })
})

test('setCurrentSession clears local unread for the opened session', () => {
  useSessionStore.setState({
    currentSessionId: null,
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
      lastReadAt: '2026-06-10T00:01:00.000Z',
      closedAt: null,
    }],
  })

  useSessionStore.getState().setCurrentSession('sess-a')

  expect(useSessionStore.getState().currentSessionId).toBe('sess-a')
  expect(useSessionStore.getState().sessions[0].unread).toBe(false)
})

test('session activity updates local running indicator within the current project', async () => {
  useAppStore.getState().setCurrentProject('project-a')
  const request = vi.spyOn(wsClient, 'request').mockResolvedValue([sessionRow()])
  const handlers = new Map<string, (msg: Record<string, unknown>) => void>()
  vi.spyOn(wsClient, 'on').mockImplementation((event, handler) => {
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
      lastReadAt: '2026-06-10T00:02:00.000Z',
      closedAt: null,
    }],
  })

  const cleanup = useSessionStore.getState().setupListeners()
  handlers.get('session:activity')?.({ type: 'session:activity', sessionId: 'sess-a', state: 'running' })

  expect(useSessionStore.getState().sessions[0]).toMatchObject({ activityState: 'running', unread: false })
  expect(useSessionStore.getState().runningSessionIds['sess-a']).toBe(true)

  await vi.waitFor(() => {
    expect(request).toHaveBeenCalledWith({ type: 'sessions.list', projectId: 'project-a' })
  })

  cleanup()
})

test('session:changed with lastReadAt updates local read state and clears unread', async () => {
  const handlers = new Map<string, (msg: Record<string, unknown>) => void>()
  vi.spyOn(wsClient, 'on').mockImplementation((event, handler) => {
    handlers.set(event, handler)
    return () => handlers.delete(event)
  })
  useSessionStore.setState({
    currentSessionId: null,
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
      lastReadAt: '2026-06-10T00:01:00.000Z',
      closedAt: null,
    }],
  })

  const cleanup = useSessionStore.getState().setupListeners()
  const newLastReadAt = '2026-06-10T00:03:00.000Z'
  handlers.get('session:changed')?.({
    type: 'session:changed',
    sessionId: 'sess-a',
    data: { lastReadAt: newLastReadAt },
  })

  expect(useSessionStore.getState().sessions[0]).toMatchObject({ unread: false, lastReadAt: newLastReadAt })

  cleanup()
})
