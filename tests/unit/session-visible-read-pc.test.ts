import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const ws = vi.hoisted(() => ({
  handlers: new Map<string, (event: Record<string, unknown>) => void>(),
  request: vi.fn(async () => [] as unknown),
  subscribe: vi.fn(), unsubscribe: vi.fn(), send: vi.fn(),
  on: vi.fn((name: string, handler: (event: Record<string, unknown>) => void) => {
    ws.handlers.set(name, handler)
    return () => ws.handlers.delete(name)
  }),
}))
vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: ws }))
const { useSessionStore } = await import('../../ui/src/stores/session.store.ts')
let cleanup: (() => void) | undefined
const visibilityHandlers = new Set<() => void>()
const readRequest = { type: 'sessions.markRead', sessionId: 'ordinary' }

beforeEach(() => {
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (name: string, handler: () => void): void => {
      if (name === 'visibilitychange') visibilityHandlers.add(handler)
    },
    removeEventListener: (_name: string, handler: () => void): void => { visibilityHandlers.delete(handler) },
  })
  ws.request.mockReset().mockResolvedValue([])
  useSessionStore.setState({
    currentSessionId: 'ordinary',
    visibleSessionId: null,
    sessions: [{ id: 'ordinary', agent_id: 'coder', project_id: 'project',
      last_message_at: '2026-09-13T06:21:42.574Z', last_read_at: '2026-09-13T06:20:00.000Z',
    } as never],
    messages: [], events: [], streamingMessage: null,
    runningSessionIds: { ordinary: true }, unreadSessionIds: {}, staleSessionIds: {},
  })
  cleanup = useSessionStore.getState().setupListeners()
})
afterEach(() => {
  useSessionStore.getState().selectSession(null)
  cleanup?.()
  vi.unstubAllGlobals()
})

describe('ordinary conversation actual visibility', () => {
  test('keeps completion unread when the window is visible but the ordinary pane is absent', () => {
    ws.handlers.get('session:done')?.({ sessionId: 'ordinary', stopReason: 'end_turn' })
    expect(ws.request).not.toHaveBeenCalledWith(readRequest)
    expect(useSessionStore.getState().unreadSessionIds.ordinary).toBe(true)
    for (const handler of visibilityHandlers) handler()
    expect(ws.request).not.toHaveBeenCalledWith(readRequest)
  })

  test('does not acknowledge an ordinary Session just because it was selected in the store', () => {
    useSessionStore.getState().selectSession(null)
    useSessionStore.getState().selectSession('ordinary')
    expect(ws.request).not.toHaveBeenCalledWith(readRequest)
  })

  test('does not drop an unread timestamp on a hidden selected Session update', () => {
    ws.handlers.get('session:changed')?.({ sessionId: 'ordinary', data: {
      last_read_at: '2026-09-13T06:20:00.000Z',
    } })
    expect(useSessionStore.getState().unreadSessionIds.ordinary).toBe(true)
  })

  test('keeps a hidden current Session unread when only idle activity is received', () => {
    ws.handlers.get('session:activity')?.({ sessionId: 'ordinary', state: 'idle' })
    expect(useSessionStore.getState().unreadSessionIds.ordinary).toBe(true)
  })

  test('reads on return to the ordinary pane, and keeps the next completion unread after leaving', () => {
    ws.handlers.get('session:done')?.({ sessionId: 'ordinary', stopReason: 'end_turn' })
    useSessionStore.getState().setVisibleSessionId('ordinary')
    expect(ws.request).toHaveBeenCalledWith(readRequest)
    expect(useSessionStore.getState().unreadSessionIds.ordinary).toBeUndefined()
    useSessionStore.getState().setVisibleSessionId(null)
    ws.request.mockClear()
    ws.handlers.get('session:done')?.({ sessionId: 'ordinary', stopReason: 'end_turn' })
    expect(ws.request).not.toHaveBeenCalledWith(readRequest)
    expect(useSessionStore.getState().unreadSessionIds.ordinary).toBe(true)
  })

  test('does not read a different selected Session before the pane switches to it', () => {
    useSessionStore.getState().setVisibleSessionId('ordinary')
    useSessionStore.setState({ currentSessionId: 'another' })
    ws.request.mockClear()
    ws.handlers.get('session:done')?.({ sessionId: 'another', stopReason: 'end_turn' })
    expect(ws.request).not.toHaveBeenCalledWith({ type: 'sessions.markRead', sessionId: 'another' })
    expect(useSessionStore.getState().unreadSessionIds.another).toBe(true)
  })

  test('does not repeatedly acknowledge unchanged visibility', () => {
    useSessionStore.getState().setVisibleSessionId('ordinary')
    useSessionStore.getState().setVisibleSessionId('ordinary')
    expect(ws.request.mock.calls.filter(([request]) => (request as Record<string, unknown>).type === 'sessions.markRead')).toHaveLength(1)
  })
})
