import { beforeEach, describe, expect, test, vi } from 'vitest'

const request = vi.fn()
const getRecovery = vi.fn()
const execute = vi.fn()
const subscribe = vi.fn()
const unsubscribe = vi.fn()
const on = vi.fn(() => vi.fn())

vi.mock('../../ui/src/services/query-client.js', () => ({
  queryClient: {
    listSessionMessages: request,
    getSessionRecovery: getRecovery,
  },
}))
vi.mock('../../ui/src/services/command-client.js', () => ({ commandClient: { execute } }))
vi.mock('../../ui/src/services/ws-client.js', () => ({ wsClient: { subscribe, unsubscribe, on } }))

describe('workbench session store', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    request.mockResolvedValue({ items: [{ id: 'message-a', session_id: 'session-a', role: 'agent', content: '完成', thinking: null, tool_calls_json: null, decision_json: null, timestamp: '2026-08-29T00:00:00.000Z' }], hasMore: false, nextCursor: null })
    getRecovery.mockResolvedValue({ sessionId: 'session-a', latestSequence: 0, events: [] })
    execute.mockResolvedValue({ commandId: 'ok', status: 'completed', duplicate: false })
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    useWorkbenchSessionStore.getState().dispose()
    const { useSessionStore } = await import('../../ui/src/stores/session.store.js')
    useSessionStore.setState({ currentSessionId: null })
  })

  test('loads a cross-project session by sessionId without touching project state', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-a' }))
    expect(subscribe).toHaveBeenCalledWith(['session-a'])
    expect(useWorkbenchSessionStore.getState().messages[0]?.content).toBe('完成')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: 'sessions.markRead', sessionId: 'session-a' }))
  })

  test('unsubscribes when the workbench is disposed', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    useWorkbenchSessionStore.getState().dispose()
    expect(unsubscribe).toHaveBeenCalledWith(['session-a'])
    expect(useWorkbenchSessionStore.getState().selectedSessionId).toBeNull()
  })

  test('does not remove a subscription still owned by Workspace', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    const { useSessionStore } = await import('../../ui/src/stores/session.store.js')
    useSessionStore.setState({ currentSessionId: 'session-a' })
    await useWorkbenchSessionStore.getState().select('session-a')
    unsubscribe.mockClear()
    useWorkbenchSessionStore.getState().dispose()
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  test('restores and responds to a pending permission request', async () => {
    getRecovery.mockResolvedValue({
      sessionId: 'session-a',
      latestSequence: 1,
      events: [{
        id: 'event-permission',
        session_id: 'session-a',
        message_id: null,
        type: 'permission.request',
        payload_json: JSON.stringify({
          permissionRequest: {
            id: 'permission-a',
            toolCall: { id: 'tool-a', title: '写入文件' },
            options: [{ optionId: 'allow-once', name: '允许一次', kind: 'allow_once' }],
          },
        }),
        sequence: 1,
        created_at: '2026-08-29T00:00:00.000Z',
      }],
    })
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')

    await useWorkbenchSessionStore.getState().select('session-a')
    expect(useWorkbenchSessionStore.getState().pendingPermissions).toHaveLength(1)

    await useWorkbenchSessionStore.getState().respondPermission('permission-a', 'allow-once')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      type: 'permission.respond',
      sessionId: 'session-a',
      permissionRequestId: 'permission-a',
      optionId: 'allow-once',
    }))
    expect(useWorkbenchSessionStore.getState().pendingPermissions).toEqual([])
  })

  test('exposes capabilities and usage restored from recovery events', async () => {
    getRecovery.mockResolvedValue({
      sessionId: 'session-a',
      latestSequence: 1,
      events: [{
        id: 'event-usage',
        session_id: 'session-a',
        message_id: null,
        type: 'usage.update',
        payload_json: JSON.stringify({ usage: { contextSize: 200000, contextUsed: 1024 } }),
        sequence: 1,
        created_at: '2026-08-29T00:00:00.000Z',
      }],
    })
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')

    expect(useWorkbenchSessionStore.getState().usage).toBeNull()
    expect(useWorkbenchSessionStore.getState().capabilities).toBeDefined()

    await useWorkbenchSessionStore.getState().select('session-a')
    const state = useWorkbenchSessionStore.getState()
    expect(state.usage).toEqual({ contextSize: 200000, contextUsed: 1024 })
    expect(state.capabilities).toBeDefined()
  })

  test('keeps restored usage/capabilities across incremental session events', async () => {
    getRecovery.mockResolvedValue({
      sessionId: 'session-a',
      latestSequence: 1,
      events: [{
        id: 'event-usage',
        session_id: 'session-a',
        message_id: null,
        type: 'usage.update',
        payload_json: JSON.stringify({ usage: { contextSize: 200000, contextUsed: 1024 } }),
        sequence: 1,
        created_at: '2026-08-29T00:00:00.000Z',
      }],
    })
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')

    const { wsClient } = await import('../../ui/src/services/ws-client.js')
    const handler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:event')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    expect(handler).toBeDefined()
    handler({
      sessionId: 'session-a',
      event: {
        id: 'event-chunk',
        session_id: 'session-a',
        message_id: 'message-live',
        type: 'message.chunk',
        payload_json: JSON.stringify({ role: 'agent', messageId: 'message-live', contentDelta: '你好' }),
        sequence: 2,
        created_at: '2026-08-29T00:01:00.000Z',
      },
    })

    const state = useWorkbenchSessionStore.getState()
    expect(state.usage).toEqual({ contextSize: 200000, contextUsed: 1024 })
    expect(state.capabilities).toBeDefined()
    expect(state.events.some((event) => event.id === 'event-chunk')).toBe(true)
  })
})
