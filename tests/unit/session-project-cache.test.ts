import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultCaps } from '../../ui/src/stores/session-events.ts'
import { ALL_PROJECTS_SCOPE, emptyProjectCache } from '../../ui/src/stores/project-cache.ts'

const wsMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(msg: Record<string, unknown>) => void>>()
  return {
    handlers,
    request: vi.fn(async () => [] as unknown[]),
    on: vi.fn((event: string, handler: (msg: Record<string, unknown>) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)?.add(handler)
      return () => handlers.get(event)?.delete(handler)
    }),
    send: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }
})

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { useSessionStore } = await import('../../ui/src/stores/session.store.ts')
type SessionData = import('../../ui/src/stores/session.store.ts').SessionData

function session(id: string, projectId: string): SessionData {
  return {
    id,
    agent_id: `agent-${projectId}`,
    task_id: null,
    acp_session_id: null,
    status: 'active',
    stage: '',
    started_at: '2026-07-17T00:00:00.000Z',
    closed_at: null,
    project_id: projectId,
  }
}

function emit(event: string, message: Record<string, unknown>): void {
  for (const handler of wsMock.handlers.get(event) ?? []) handler(message)
}

describe('session project cache', () => {
  beforeEach(() => {
    wsMock.handlers.clear()
    wsMock.request.mockReset()
    useSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: [],
      events: [],
      streamingMessage: null,
      usage: null,
      turnUsage: null,
      capabilities: { ...defaultCaps },
      plan: [],
      pendingPermissions: [],
      pendingElicitations: [],
      loading: false,
      refreshing: false,
      activeSessionScope: ALL_PROJECTS_SCOPE,
      sessionListCache: emptyProjectCache<SessionData[]>(),
    })
  })

  test('restores each project session list synchronously', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'sessions.list') return []
      return msg.projectId === 'a' ? [session('session-a', 'a')] : [session('session-b', 'b')]
    })

    useSessionStore.getState().activateProject('a')
    await useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })
    useSessionStore.getState().activateProject('b')
    await useSessionStore.getState().fetchSessions(undefined, 'b', { force: true })
    useSessionStore.getState().activateProject('a')

    expect(useSessionStore.getState().sessions.map((item) => item.id)).toEqual(['session-a'])
    expect(useSessionStore.getState().sessionListCache.entries.b?.data.map((item) => item.id))
      .toEqual(['session-b'])
    expect(useSessionStore.getState().loading).toBe(false)
  })

  test('routes a complete background session update to its project cache', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'sessions.list') return []
      return msg.projectId === 'a' ? [session('session-a', 'a')] : [session('session-b', 'b')]
    })
    useSessionStore.getState().activateProject('a')
    await useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })
    useSessionStore.getState().activateProject('b')
    await useSessionStore.getState().fetchSessions(undefined, 'b', { force: true })
    useSessionStore.getState().activateProject('a')
    const cleanup = useSessionStore.getState().setupListeners()

    emit('session:changed', {
      sessionId: 'session-b-new',
      data: session('session-b-new', 'b'),
    })

    expect(useSessionStore.getState().sessions.map((item) => item.id)).toEqual(['session-a'])
    expect(useSessionStore.getState().sessionListCache.entries.b?.data.map((item) => item.id))
      .toEqual(['session-b-new', 'session-b'])
    cleanup()
  })
})
