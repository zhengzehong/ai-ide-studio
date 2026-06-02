import { describe, expect, test, vi } from 'vitest'
import { defaultCaps } from '../../ui/src/stores/session-events.ts'

const wsMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(msg: Record<string, unknown>) => void>>()
  const request = vi.fn(async () => [])
  const on = vi.fn((event: string, handler: (msg: Record<string, unknown>) => void) => {
    if (!handlers.has(event)) handlers.set(event, new Set())
    handlers.get(event)?.add(handler)
    return () => handlers.get(event)?.delete(handler)
  })
  return {
    handlers,
    request,
    on,
    send: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }
})

vi.mock('../../ui/src/services/ws-client', () => ({
  wsClient: wsMock,
}))

const { useSessionStore } = await import('../../ui/src/stores/session.store.ts')

function resetStore(): void {
  useSessionStore.setState({
    sessions: [],
    currentSessionId: 'sess-refresh',
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
    toolCallSummariesByMessageId: {},
    toolCallDetailsByKey: {},
    toolCallLoadingByKey: {},
    toolCallErrorByKey: {},
  })
}

function emit(event: string, message: Record<string, unknown>): void {
  for (const handler of wsMock.handlers.get(event) ?? []) handler(message)
}

describe('session store done handling', () => {
  test('refreshes persisted events once after a turn is done so the final reply can use timeline rendering', async () => {
    resetStore()
    wsMock.request.mockClear()
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:done', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        messageId: 'done-sess-refresh',
        stopReason: 'end_turn',
      })

      await vi.waitFor(() => {
        expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.events', sessionId: 'sess-refresh', limit: 1000 })
      })
    } finally {
      cleanup()
    }
  })
})
