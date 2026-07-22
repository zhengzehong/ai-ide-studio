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
  MOBILE_PROJECT_SESSION_STATS_DEBOUNCE_MS,
  useMobileProjectSessionStatsStore,
} = await import('../../mobile/src/stores/project-session-stats.store.ts')

function snapshot(projectId: string, sessionCount: number, runningCount: number, unreadCount: number) {
  return {
    generatedAt: '2026-07-21T00:00:00.000Z',
    items: [{ projectId, sessionCount, runningCount, unreadCount }],
  }
}

function emit(event: string): void {
  for (const handler of wsMock.handlers.get(event) ?? []) handler({ type: event })
}

beforeEach(() => {
  wsMock.handlers.clear()
  wsMock.request.mockReset()
  useMobileProjectSessionStatsStore.setState({
    statsByProjectId: {},
    initialized: false,
    loading: false,
    refreshing: false,
    error: null,
    requestSeq: 0,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mobile project session stats store', () => {
  test('loads counts for projects outside the selected project', async () => {
    wsMock.request.mockResolvedValue({
      generatedAt: '2026-07-21T00:00:00.000Z',
      items: [
        { projectId: 'project-a', sessionCount: 2, runningCount: 0, unreadCount: 0 },
        { projectId: 'project-b', sessionCount: 5, runningCount: 1, unreadCount: 3 },
      ],
    })

    await useMobileProjectSessionStatsStore.getState().fetchStats()

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.projectStats' })
    expect(useMobileProjectSessionStatsStore.getState().statsByProjectId).toEqual({
      'project-a': { projectId: 'project-a', sessionCount: 2, runningCount: 0, unreadCount: 0 },
      'project-b': { projectId: 'project-b', sessionCount: 5, runningCount: 1, unreadCount: 3 },
    })
  })

  test('keeps the last successful snapshot when a background refresh fails', async () => {
    useMobileProjectSessionStatsStore.setState({
      statsByProjectId: {
        'project-a': { projectId: 'project-a', sessionCount: 4, runningCount: 0, unreadCount: 2 },
      },
      initialized: true,
    })
    wsMock.request.mockRejectedValue(new Error('offline'))

    await useMobileProjectSessionStatsStore.getState().fetchStats({ force: true })

    expect(useMobileProjectSessionStatsStore.getState()).toMatchObject({
      statsByProjectId: {
        'project-a': { projectId: 'project-a', sessionCount: 4, runningCount: 0, unreadCount: 2 },
      },
      initialized: true,
      loading: false,
      refreshing: false,
      error: 'offline',
    })
  })

  test('debounces activity, changed, and done events into one all-project refresh', async () => {
    vi.useFakeTimers()
    wsMock.request.mockResolvedValue(snapshot('project-a', 3, 0, 1))
    const cleanup = useMobileProjectSessionStatsStore.getState().setupListeners()

    emit('session:activity')
    emit('session:changed')
    emit('session:done')
    await vi.advanceTimersByTimeAsync(MOBILE_PROJECT_SESSION_STATS_DEBOUNCE_MS - 1)
    expect(wsMock.request).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(wsMock.request).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
