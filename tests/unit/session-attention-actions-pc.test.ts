import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const wsMock = vi.hoisted(() => ({
  handlers: new Map<string, (message: Record<string, unknown>) => void>(),
  request: vi.fn(async () => ({ ok: true }) as unknown),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  on: vi.fn((event: string, handler: (message: Record<string, unknown>) => void) => {
    wsMock.handlers.set(event, handler)
    return () => wsMock.handlers.delete(event)
  }),
}))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { WorkspaceSessionActions } = await import('../../ui/src/components/chat/WorkspaceSessionActions.tsx')
const {
  readSessionSelectionGeneration,
  readProjectLastSession,
  useSessionStore,
  writeProjectLastSession,
} = await import('../../ui/src/stores/session.store.ts')

beforeEach(() => {
  wsMock.request.mockReset()
  wsMock.request.mockResolvedValue({ ok: true })
  wsMock.handlers.clear()
  useSessionStore.setState({
    sessions: [],
    currentSessionId: null,
    visibleSessionId: 'session-a',
    unreadSessionIds: {},
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('desktop Session attention actions', () => {
  test('renders the four first-level actions in the approved order', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceSessionActions, {
      pinned: false,
      canMarkUnread: true,
      timelineOpen: false,
      pendingAction: null,
      onShare: () => undefined,
      onTogglePin: () => undefined,
      onMarkUnread: () => undefined,
      onToggleTimeline: () => undefined,
    }))

    expect(html.indexOf('分享')).toBeLessThan(html.indexOf('置顶'))
    expect(html.indexOf('置顶')).toBeLessThan(html.indexOf('标记未读'))
    expect(html.indexOf('标记未读')).toBeLessThan(html.indexOf('时间线'))
    expect(html).not.toContain('取消置顶')
  })

  test('uses the cancel label when the Session is pinned', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceSessionActions, {
      pinned: true,
      canMarkUnread: true,
      timelineOpen: false,
      pendingAction: null,
      onShare: () => undefined,
      onTogglePin: () => undefined,
      onMarkUnread: () => undefined,
      onToggleTimeline: () => undefined,
    }))

    expect(html).toContain('取消置顶')
  })

  test('persists unread before the Workspace clears its current selection without inventing a read cursor', async () => {
    useSessionStore.setState({
      sessions: [{
        id: 'session-a',
        last_message_at: '2026-08-27T08:00:00.000Z',
        last_read_at: '2026-08-27T08:00:00.000Z',
      } as never],
      currentSessionId: 'session-a',
      unreadSessionIds: {},
    })

    await useSessionStore.getState().markUnread('session-a')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.markUnread', sessionId: 'session-a' })
    expect(useSessionStore.getState().currentSessionId).toBe('session-a')
    expect(useSessionStore.getState().unreadSessionIds['session-a']).toBe(true)
    expect(useSessionStore.getState().sessions[0]?.last_read_at).toBe('2026-08-27T08:00:00.000Z')

    useSessionStore.getState().selectSession(null)
    expect(useSessionStore.getState().currentSessionId).toBeNull()
    expect(useSessionStore.getState().unreadSessionIds['session-a']).toBe(true)
  })

  test('clears the project restore target after marking unread', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    useSessionStore.getState().activateProject('project-a')
    writeProjectLastSession('project-a', 'session-a')
    useSessionStore.setState({
      sessions: [{
        id: 'session-a',
        last_message_at: '2026-08-27T08:00:00.000Z',
        last_read_at: '2026-08-27T08:00:00.000Z',
      } as never],
      currentSessionId: 'session-a',
    })

    await useSessionStore.getState().markUnread('session-a')

    expect(readProjectLastSession('project-a')).toBeNull()
  })

  test('keeps an explicit marked-unread event authoritative for the current Session', () => {
    useSessionStore.setState({
      sessions: [{
        id: 'session-a',
        last_message_at: '2026-08-27T08:00:00.000Z',
        last_read_at: '2026-08-27T08:00:00.000Z',
      } as never],
      currentSessionId: 'session-a',
      unreadSessionIds: {},
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      wsMock.handlers.get('session:changed')?.({
        sessionId: 'session-a',
        data: {
          event: 'marked_unread',
          last_read_at: '2026-08-27T07:59:59.999Z',
        },
      })

      expect(useSessionStore.getState().unreadSessionIds['session-a']).toBe(true)
    } finally {
      useSessionStore.getState().selectSession(null)
      cleanup()
    }
  })

  test('does not acknowledge a terminal event while an explicit unread intent is pending navigation', async () => {
    useSessionStore.setState({
      sessions: [{
        id: 'session-a',
        last_message_at: '2026-08-27T08:00:00.000Z',
        last_read_at: '2026-08-27T08:00:00.000Z',
      } as never],
      currentSessionId: 'session-a',
      unreadSessionIds: {},
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      await useSessionStore.getState().markUnread('session-a')
      wsMock.request.mockClear()
      wsMock.handlers.get('session:done')?.({
        sessionId: 'session-a',
        agentId: 'agent-a',
        messageId: 'message-final',
        stopReason: 'end_turn',
      })
      await Promise.resolve()

      expect(wsMock.request).not.toHaveBeenCalledWith({
        type: 'sessions.markRead',
        sessionId: 'session-a',
      })
      expect(useSessionStore.getState().unreadSessionIds['session-a']).toBe(true)
    } finally {
      useSessionStore.getState().selectSession(null)
      cleanup()
    }
  })

  test('blocks automatic read acknowledgement before the mark-unread request completes', async () => {
    let resolveMarkUnread: (() => void) | undefined
    wsMock.request.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.type !== 'sessions.markUnread') return []
      await new Promise<void>((resolve) => { resolveMarkUnread = resolve })
      return { ok: true }
    })
    useSessionStore.setState({
      sessions: [{
        id: 'session-a',
        last_message_at: '2026-08-27T08:00:00.000Z',
        last_read_at: '2026-08-27T08:00:00.000Z',
      } as never],
      currentSessionId: 'session-a',
      unreadSessionIds: {},
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      const pending = useSessionStore.getState().markUnread('session-a')
      wsMock.handlers.get('session:done')?.({
        sessionId: 'session-a',
        agentId: 'agent-a',
        messageId: 'message-during-request',
        stopReason: 'end_turn',
      })
      await Promise.resolve()

      expect(wsMock.request).not.toHaveBeenCalledWith({
        type: 'sessions.markRead',
        sessionId: 'session-a',
      })
      resolveMarkUnread?.()
      await pending
    } finally {
      useSessionStore.getState().selectSession(null)
      cleanup()
    }
  })

  test('compensates an automatic read suppressed before persistence fails', async () => {
    let rejectMarkUnread: ((error: Error) => void) | undefined
    wsMock.request.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.type !== 'sessions.markUnread') return []
      await new Promise<void>((_resolve, reject) => { rejectMarkUnread = reject })
      return { ok: true }
    })
    useSessionStore.setState({
      sessions: [{
        id: 'session-a',
        last_message_at: '2026-08-27T08:00:00.000Z',
        last_read_at: '2026-08-27T08:00:00.000Z',
      } as never],
      currentSessionId: 'session-a',
      unreadSessionIds: {},
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      const pending = useSessionStore.getState().markUnread('session-a')
      wsMock.handlers.get('session:done')?.({
        sessionId: 'session-a',
        agentId: 'agent-a',
        messageId: 'message-before-failure',
        stopReason: 'end_turn',
      })
      await Promise.resolve()
      wsMock.request.mockClear()
      wsMock.request.mockResolvedValue([])
      rejectMarkUnread?.(new Error('write failed'))
      await expect(pending).rejects.toThrow('write failed')
      await Promise.resolve()

      expect(wsMock.request).toHaveBeenCalledWith({
        type: 'sessions.markRead',
        sessionId: 'session-a',
      })
    } finally {
      useSessionStore.getState().selectSession(null)
      cleanup()
    }
  })

  test('increments the selection generation across an A-B-A navigation', () => {
    useSessionStore.setState({ currentSessionId: null })
    const before = readSessionSelectionGeneration()

    useSessionStore.getState().selectSession('session-a')
    const firstA = readSessionSelectionGeneration()
    useSessionStore.getState().selectSession('session-b')
    useSessionStore.getState().selectSession('session-a')

    expect(firstA).toBeGreaterThan(before)
    expect(readSessionSelectionGeneration()).toBeGreaterThan(firstA)
    useSessionStore.getState().selectSession(null)
  })

  test('does not acknowledge visibility while an explicit unread intent is pending navigation', async () => {
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
    useSessionStore.setState({
      sessions: [{
        id: 'session-a',
        last_message_at: '2026-08-27T08:00:00.000Z',
        last_read_at: '2026-08-27T08:00:00.000Z',
      } as never],
      currentSessionId: 'session-a',
      unreadSessionIds: {},
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      await useSessionStore.getState().markUnread('session-a')
      wsMock.request.mockClear()
      for (const handler of visibilityHandlers) handler()
      await Promise.resolve()

      expect(wsMock.request).not.toHaveBeenCalledWith({
        type: 'sessions.markRead',
        sessionId: 'session-a',
      })
      expect(useSessionStore.getState().unreadSessionIds['session-a']).toBe(true)
    } finally {
      useSessionStore.getState().selectSession(null)
      cleanup()
    }
  })
})
