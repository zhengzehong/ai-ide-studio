import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const wsMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(msg: Record<string, unknown>) => void>>()
  return {
    handlers,
    request: vi.fn<(msg: Record<string, unknown>) => Promise<unknown>>(),
    on: vi.fn((event: string, handler: (msg: Record<string, unknown>) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)?.add(handler)
      return () => handlers.get(event)?.delete(handler)
    }),
  }
})

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const {
  PROJECT_SESSION_STATS_DEBOUNCE_MS,
  PROJECT_SESSION_STATS_STALE_MS,
  useProjectSessionStatsStore,
} = await import('../../ui/src/stores/project-session-stats.store.ts')

function snapshot(projectId: string, runningCount: number, unreadCount: number) {
  return {
    generatedAt: '2026-07-17T00:00:00.000Z',
    items: [{ projectId, runningCount, unreadCount }],
  }
}

function emit(event: string): void {
  for (const handler of wsMock.handlers.get(event) ?? []) handler({ type: event })
}

beforeEach(() => {
  wsMock.handlers.clear()
  wsMock.request.mockReset()
  useProjectSessionStatsStore.setState({
    statsByProjectId: {},
    initialized: false,
    loading: false,
    refreshing: false,
    error: null,
    fetchedAt: null,
    requestSeq: 0,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('project session stats store', () => {
  test('loads a complete project stats snapshot', async () => {
    wsMock.request.mockResolvedValue(snapshot('project-a', 2, 3))

    await useProjectSessionStatsStore.getState().fetchStats()

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.projectStats' })
    expect(useProjectSessionStatsStore.getState()).toMatchObject({
      statsByProjectId: {
        'project-a': { projectId: 'project-a', runningCount: 2, unreadCount: 3 },
      },
      initialized: true,
      loading: false,
      refreshing: false,
      error: null,
    })
    expect(useProjectSessionStatsStore.getState().fetchedAt).toEqual(expect.any(Number))
  })

  test('keeps the last successful snapshot when refresh fails', async () => {
    useProjectSessionStatsStore.setState({
      statsByProjectId: {
        'project-a': { projectId: 'project-a', runningCount: 1, unreadCount: 4 },
      },
      initialized: true,
      fetchedAt: 100,
    })
    wsMock.request.mockRejectedValue(new Error('offline'))

    await useProjectSessionStatsStore.getState().fetchStats({ force: true })

    expect(useProjectSessionStatsStore.getState()).toMatchObject({
      statsByProjectId: {
        'project-a': { projectId: 'project-a', runningCount: 1, unreadCount: 4 },
      },
      initialized: true,
      loading: false,
      refreshing: false,
      error: 'offline',
      fetchedAt: 100,
    })
  })

  test('ignores an older response that resolves after a newer request', async () => {
    let resolveOlder: ((value: unknown) => void) | undefined
    let resolveNewer: ((value: unknown) => void) | undefined
    wsMock.request
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve }))

    const older = useProjectSessionStatsStore.getState().fetchStats({ force: true })
    const newer = useProjectSessionStatsStore.getState().fetchStats({ force: true })
    resolveNewer?.(snapshot('project-a', 5, 0))
    await newer
    resolveOlder?.(snapshot('project-a', 1, 9))
    await older

    expect(useProjectSessionStatsStore.getState().statsByProjectId['project-a'])
      .toEqual({ projectId: 'project-a', runningCount: 5, unreadCount: 0 })
  })

  test('debounces activity and changed events into one refresh', async () => {
    vi.useFakeTimers()
    wsMock.request.mockResolvedValue(snapshot('project-a', 1, 0))
    const cleanup = useProjectSessionStatsStore.getState().setupListeners()

    emit('session:activity')
    emit('session:changed')
    await vi.advanceTimersByTimeAsync(PROJECT_SESSION_STATS_DEBOUNCE_MS - 1)
    expect(wsMock.request).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(wsMock.request).toHaveBeenCalledTimes(1)
    cleanup()
  })

  test('refreshes stale project summaries every 30 seconds', async () => {
    vi.useFakeTimers()
    wsMock.request.mockResolvedValue(snapshot('project-a', 1, 0))
    useProjectSessionStatsStore.setState({
      initialized: true,
      fetchedAt: Date.now() - PROJECT_SESSION_STATS_STALE_MS,
    })
    const cleanup = useProjectSessionStatsStore.getState().setupListeners()

    await vi.advanceTimersByTimeAsync(PROJECT_SESSION_STATS_STALE_MS)

    expect(wsMock.request).toHaveBeenCalledTimes(1)
    cleanup()
  })

  test('forces recovery when the document becomes visible', async () => {
    vi.useFakeTimers()
    const visibilityHandlers = new Set<() => void>()
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (event: string, handler: () => void) => {
        if (event === 'visibilitychange') visibilityHandlers.add(handler)
      },
      removeEventListener: (event: string, handler: () => void) => {
        if (event === 'visibilitychange') visibilityHandlers.delete(handler)
      },
    })
    wsMock.request.mockResolvedValue(snapshot('project-a', 0, 0))
    useProjectSessionStatsStore.setState({ initialized: true, fetchedAt: Date.now() })
    const cleanup = useProjectSessionStatsStore.getState().setupListeners()

    for (const handler of visibilityHandlers) handler()
    await vi.runAllTicks()

    expect(wsMock.request).toHaveBeenCalledTimes(1)
    cleanup()
    expect(visibilityHandlers.size).toBe(0)
    vi.unstubAllGlobals()
  })
})
