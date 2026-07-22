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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  }
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
      error: null,
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

  test('keeps the active project visible while another project refreshes in the background', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'sessions.list') return []
      return msg.projectId === 'a' ? [session('session-a', 'a')] : [session('session-b', 'b')]
    })

    useSessionStore.getState().activateProject('a')
    await useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })

    await useSessionStore.getState().fetchSessions(undefined, 'b', { force: true })

    expect(useSessionStore.getState()).toMatchObject({
      activeSessionScope: 'a',
      loading: false,
      refreshing: false,
      error: null,
    })
    expect(useSessionStore.getState().sessions.map((item) => item.id)).toEqual(['session-a'])
    expect(useSessionStore.getState().sessionListCache.entries.b?.data.map((item) => item.id))
      .toEqual(['session-b'])
  })

  test('keeps the active project loading while a background project fetch completes', async () => {
    const projectALoad = deferred<SessionData[]>()
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'sessions.list') return []
      if (msg.projectId === 'a') return projectALoad.promise
      return [session('session-b', 'b')]
    })

    useSessionStore.getState().activateProject('a')
    const activeLoad = useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })
    expect(useSessionStore.getState().loading).toBe(true)

    await useSessionStore.getState().fetchSessions(undefined, 'b', { force: true })
    const stateDuringActiveLoad = useSessionStore.getState()
    projectALoad.resolve([session('session-a', 'a')])
    await activeLoad

    expect(stateDuringActiveLoad).toMatchObject({
      activeSessionScope: 'a',
      loading: true,
      refreshing: false,
      error: null,
    })
  })

  test('keeps the active project refreshing while a background project fetch completes', async () => {
    const projectARefresh = deferred<SessionData[]>()
    let projectACalls = 0
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'sessions.list') return []
      if (msg.projectId === 'a') {
        projectACalls += 1
        if (projectACalls === 1) return [session('session-a-stale', 'a')]
        return projectARefresh.promise
      }
      return [session('session-b', 'b')]
    })

    useSessionStore.getState().activateProject('a')
    await useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })
    const activeRefresh = useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })
    expect(useSessionStore.getState().refreshing).toBe(true)

    await useSessionStore.getState().fetchSessions(undefined, 'b', { force: true })
    const stateDuringActiveRefresh = useSessionStore.getState()
    projectARefresh.resolve([session('session-a-fresh', 'a')])
    await activeRefresh

    expect(stateDuringActiveRefresh).toMatchObject({
      activeSessionScope: 'a',
      loading: false,
      refreshing: true,
      error: null,
    })
  })

  test('keeps the active project error state isolated from a failed background refresh', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'sessions.list') return []
      if (msg.projectId === 'b') throw new Error('Project B session refresh failed')
      return [session('session-a', 'a')]
    })

    useSessionStore.getState().activateProject('a')
    await useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })

    await useSessionStore.getState().fetchSessions(undefined, 'b', { force: true })

    expect(useSessionStore.getState()).toMatchObject({
      activeSessionScope: 'a',
      loading: false,
      refreshing: false,
      error: null,
    })
    expect(useSessionStore.getState().sessions.map((item) => item.id)).toEqual(['session-a'])
    expect(useSessionStore.getState().sessionListCache.errorsByScope?.b)
      .toBe('Project B session refresh failed')
  })

  test('exposes a cold load failure and clears it after retry', async () => {
    wsMock.request.mockRejectedValueOnce(new Error('Session service unavailable'))

    useSessionStore.getState().activateProject('a')
    await useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })

    expect(useSessionStore.getState()).toMatchObject({
      sessions: [],
      loading: false,
      error: 'Session service unavailable',
    })

    wsMock.request.mockResolvedValueOnce([session('session-a', 'a')])
    await useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })

    expect(useSessionStore.getState().sessions.map((item) => item.id)).toEqual(['session-a'])
    expect(useSessionStore.getState().error).toBeNull()
  })

  test('restores an evicted project from its in-flight refresh instead of showing no sessions', async () => {
    const refreshA = deferred<SessionData[]>()
    let projectACalls = 0
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'sessions.list') return []
      if (msg.projectId === 'a') {
        projectACalls += 1
        if (projectACalls === 1) return [session('session-a-stale', 'a')]
        return refreshA.promise
      }
      return [session(`session-${String(msg.projectId)}`, String(msg.projectId))]
    })

    useSessionStore.getState().activateProject('a')
    await useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })
    const backgroundRefresh = useSessionStore.getState().fetchSessions(undefined, 'a', { force: true })

    for (const projectId of ['b', 'c', 'd', 'e', 'f']) {
      useSessionStore.getState().activateProject(projectId)
      await useSessionStore.getState().fetchSessions(undefined, projectId, { force: true })
    }

    useSessionStore.getState().activateProject('a')

    expect(useSessionStore.getState()).toMatchObject({
      sessions: [],
      loading: true,
    })

    refreshA.resolve([session('session-a-fresh', 'a')])
    await backgroundRefresh

    expect(useSessionStore.getState().sessions.map((item) => item.id)).toEqual(['session-a-fresh'])
    expect(useSessionStore.getState().loading).toBe(false)
  })
})
