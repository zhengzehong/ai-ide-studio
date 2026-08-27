import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const wsMock = vi.hoisted(() => ({
  handlers: new Map<string, (message: Record<string, unknown>) => void>(),
  request: vi.fn(async () => ({ ok: true }) as unknown),
  on: vi.fn((event: string, handler: (message: Record<string, unknown>) => void) => {
    wsMock.handlers.set(event, handler)
    return () => wsMock.handlers.delete(event)
  }),
}))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { default: ChatInput } = await import('../../mobile/src/components/chat/ChatInput.tsx')
const { SessionAttentionPanel } = await import('../../mobile/src/components/chat/SessionAttentionPanel.tsx')
const { useSessionStore } = await import('../../mobile/src/stores/session.store.ts')

beforeEach(() => {
  wsMock.request.mockReset()
  wsMock.request.mockResolvedValue({ ok: true })
  wsMock.handlers.clear()
  useSessionStore.setState({ sessions: [], currentSessionId: null })
})

describe('mobile Session attention actions', () => {
  test('places the plus button after send and expands the panel below the composer', () => {
    const panel = createElement(SessionAttentionPanel, {
      pinned: false,
      pendingAction: null,
      canMarkUnread: true,
      onTogglePin: () => undefined,
      onMarkUnread: () => undefined,
    })
    const html = renderToStaticMarkup(createElement(ChatInput, {
      onSend: () => undefined,
      onCancel: () => undefined,
      isRunning: false,
      actionsOpen: true,
      onToggleActions: () => undefined,
      actionsPanel: panel,
    }))

    expect(html.indexOf('aria-label="发送"')).toBeLessThan(html.indexOf('aria-label="会话操作"'))
    expect(html.indexOf('aria-label="会话操作"')).toBeLessThan(html.indexOf('data-session-attention-panel="true"'))
    expect(html.match(/data-session-attention-action=/g)).toHaveLength(2)
    expect(html).toContain('置顶')
    expect(html).toContain('标记未读')
  })

  test('uses the cancel-pin label for an already pinned Session', () => {
    const html = renderToStaticMarkup(createElement(SessionAttentionPanel, {
      pinned: true,
      pendingAction: null,
      canMarkUnread: true,
      onTogglePin: () => undefined,
      onMarkUnread: () => undefined,
    }))

    expect(html).toContain('取消置顶')
  })

  test('persists unread locally without leaving navigation decisions to the store', async () => {
    useSessionStore.setState({
      sessions: [{
        id: 'session-a',
        agentId: 'agent-a',
        agentName: 'Agent A',
        projectId: 'project-a',
        projectName: 'Project A',
        taskId: null,
        sessionTitle: 'Session A',
        status: 'active',
        activityState: 'idle',
        stage: '',
        unread: false,
        startedAt: '2026-08-27T07:00:00.000Z',
        updatedAt: '2026-08-27T08:00:00.000Z',
        lastMessageAt: '2026-08-27T08:00:00.000Z',
        lastReadAt: '2026-08-27T08:00:00.000Z',
        closedAt: null,
      }],
      currentSessionId: 'session-a',
    })

    await useSessionStore.getState().markUnread('session-a')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.markUnread', sessionId: 'session-a' })
    expect(useSessionStore.getState().currentSessionId).toBe('session-a')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      unread: true,
      lastReadAt: '2026-08-27T07:59:59.999Z',
    })
  })

  test('keeps an explicit marked-unread event unread while the Session is current', () => {
    useSessionStore.setState({
      sessions: [{
        id: 'session-a',
        lastMessageAt: '2026-08-27T08:00:00.000Z',
        lastReadAt: '2026-08-27T08:00:00.000Z',
        unread: false,
      } as never],
      currentSessionId: 'session-a',
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

      expect(useSessionStore.getState().sessions[0]?.unread).toBe(true)
    } finally {
      cleanup()
    }
  })

  test('allows the server to mark a cross-project pinned Session unread without a local list row', async () => {
    wsMock.request.mockResolvedValue({
      sessionId: 'session-cross-project',
      lastReadAt: '2026-08-27T07:59:59.999Z',
    })
    useSessionStore.setState({
      sessions: [],
      currentSessionId: 'session-cross-project',
    })

    await expect(useSessionStore.getState().markUnread('session-cross-project')).resolves.toBeUndefined()
    expect(wsMock.request).toHaveBeenCalledWith({
      type: 'sessions.markUnread',
      sessionId: 'session-cross-project',
    })
  })
})
