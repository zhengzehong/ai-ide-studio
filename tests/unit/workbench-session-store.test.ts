import { beforeEach, describe, expect, test, vi } from 'vitest'

const request = vi.fn()
const getRecovery = vi.fn()
const execute = vi.fn()
const subscribe = vi.fn()
const unsubscribe = vi.fn()
const on = vi.fn(() => vi.fn())
const wsRequest = vi.fn()

vi.mock('../../ui/src/services/query-client.js', () => ({
  queryClient: {
    listSessionMessages: request,
    getSessionRecovery: getRecovery,
  },
}))
vi.mock('../../ui/src/services/command-client.js', () => ({ commandClient: { execute } }))
vi.mock('../../ui/src/services/ws-client.js', () => ({ wsClient: { subscribe, unsubscribe, on, request: wsRequest } }))

describe('workbench session store', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    request.mockResolvedValue({ items: [{ id: 'message-a', session_id: 'session-a', role: 'agent', content: '完成', thinking: null, tool_calls_json: null, decision_json: null, timestamp: '2026-08-29T00:00:00.000Z' }], hasMore: false, nextCursor: null })
    getRecovery.mockResolvedValue({ sessionId: 'session-a', latestSequence: 0, events: [] })
    execute.mockResolvedValue({ commandId: 'ok', status: 'completed', duplicate: false })
    wsRequest.mockReset()
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

  test('restores streaming state from a recovery event received after selection', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    const { wsClient } = await import('../../ui/src/services/ws-client.js')
    const handler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:event')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    handler?.({
      sessionId: 'session-a',
      event: {
        id: 'event-stage', session_id: 'session-a', message_id: 'message-live', type: 'lifecycle.prompt_sent',
        payload_json: JSON.stringify({ messageId: 'message-live', content: '正在执行' }), sequence: 2, created_at: '2026-08-29T00:01:00.000Z',
      },
    })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.stage).toBe('正在执行')
  })

  test('applies each incremental event once without duplicating earlier output', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    const { wsClient } = await import('../../ui/src/services/ws-client.js')
    const handler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:event')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    const event = (id: string, sequence: number, contentDelta: string) => ({
      sessionId: 'session-a',
      event: {
        id, session_id: 'session-a', message_id: 'message-live', type: 'message.chunk',
        payload_json: JSON.stringify({ messageId: 'message-live', role: 'agent', contentDelta }), sequence, created_at: '2026-08-29T00:01:00.000Z',
      },
    })
    handler?.(event('event-chunk-1', 2, '甲'))
    handler?.(event('event-chunk-2', 3, '乙'))
    expect(useWorkbenchSessionStore.getState().streamingMessage?.finalAnswer).toBe('甲乙')
  })

  test('does not apply the persisted mirror of a realtime message update twice', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    const updateHandler = on.mock.calls.find(([eventType]) => eventType === 'session:update')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    const eventHandler = on.mock.calls.find(([eventType]) => eventType === 'session:event')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    updateHandler?.({ sessionId: 'session-a', data: { messageId: 'message-live', role: 'agent', contentDelta: '甲' } })
    eventHandler?.({
      sessionId: 'session-a',
      event: {
        id: 'event-mirror', session_id: 'session-a', message_id: 'message-live', type: 'message.chunk',
        payload_json: JSON.stringify({ messageId: 'message-live', role: 'agent', contentDelta: '甲' }), sequence: 2, created_at: '2026-08-29T00:01:00.000Z',
      },
    })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.finalAnswer).toBe('甲')
  })

  test('does not double apply when the persisted mirror arrives before the realtime update', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    const eventHandler = on.mock.calls.find(([eventType]) => eventType === 'session:event')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    const updateHandler = on.mock.calls.find(([eventType]) => eventType === 'session:update')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    const event = {
      id: 'event-mirror-first', session_id: 'session-a', message_id: 'message-live', type: 'message.chunk',
      payload_json: JSON.stringify({ messageId: 'message-live', role: 'agent', contentDelta: 'first' }), sequence: 2, created_at: '2026-08-29T00:01:00.000Z',
    }
    eventHandler?.({ sessionId: 'session-a', event })
    updateHandler?.({ sessionId: 'session-a', data: { messageId: 'message-live', role: 'agent', contentDelta: 'first' } })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.finalAnswer).toBe('first')
  })

  test('keeps rich tool fields when the lightweight persisted mirror arrives first', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    const eventHandler = on.mock.calls.find(([eventType]) => eventType === 'session:event')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    const updateHandler = on.mock.calls.find(([eventType]) => eventType === 'session:update')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    eventHandler?.({
      sessionId: 'session-a',
      event: {
        id: 'event-tool-first', session_id: 'session-a', message_id: 'message-live', type: 'tool.call',
        payload_json: JSON.stringify({ messageId: 'message-live', toolCall: { id: 'tool-rich', title: '执行检查', status: 'in_progress' } }), sequence: 2, created_at: '2026-08-29T00:01:00.000Z',
      },
    })
    updateHandler?.({ sessionId: 'session-a', data: { messageId: 'message-live', role: 'agent', toolCall: { id: 'tool-rich', title: '执行检查', status: 'completed', rawInput: { path: 'README.md' }, rawOutput: 'ok' } } })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks.filter((block) => block.kind === 'tool')).toHaveLength(1)
    expect(useWorkbenchSessionStore.getState().streamingMessage?.toolCalls[0]).toMatchObject({ status: 'completed', rawInput: { path: 'README.md' }, rawOutput: 'ok' })
  })

  test('preserves consecutive identical event-only chunks', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    const eventHandler = on.mock.calls.find(([eventType]) => eventType === 'session:event')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    const event = (id: string, sequence: number) => ({
      sessionId: 'session-a',
      event: {
        id, session_id: 'session-a', message_id: 'message-live', type: 'message.chunk',
        payload_json: JSON.stringify({ messageId: 'message-live', role: 'agent', contentDelta: 'same' }), sequence, created_at: '2026-08-29T00:01:00.000Z',
      },
    })
    eventHandler?.(event('event-same-1', 2))
    eventHandler?.(event('event-same-2', 3))
    expect(useWorkbenchSessionStore.getState().streamingMessage?.finalAnswer).toBe('samesame')
  })

  test('deduplicates realtime thinking when the canonical process item arrives out of order', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    const updateHandler = on.mock.calls.find(([eventType]) => eventType === 'session:update')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    const processHandler = on.mock.calls.find(([eventType]) => eventType === 'session:process_item')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    updateHandler?.({ sessionId: 'session-a', data: { messageId: 'message-live', role: 'agent', thinking: '检查中' } })
    processHandler?.({
      sessionId: 'session-a',
      item: {
        id: 'tpi-thinking-1', session_id: 'session-a', message_id: 'message-live', sequence: 1, kind: 'thinking', status: 'completed', title: '思考过程', summary: '检查中', preview: '检查中', content: '检查中', meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false,
      },
    })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks.filter((block) => block.kind === 'thinking')).toHaveLength(1)
  })

  test('keeps a canonical thinking item single when it arrives before the realtime update', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    const { wsClient } = await import('../../ui/src/services/ws-client.js')
    const processHandler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:process_item')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    const updateHandler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:update')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    processHandler?.({
      sessionId: 'session-a',
      item: {
        id: 'tpi-thinking-2', session_id: 'session-a', message_id: 'message-live', sequence: 1, kind: 'thinking', status: 'completed', title: 'thinking', summary: 'first', preview: 'first', content: 'first', meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false,
      },
    })
    updateHandler?.({ sessionId: 'session-a', data: { messageId: 'message-live', role: 'agent', thinking: 'first' } })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks.filter((block) => block.kind === 'thinking')).toHaveLength(1)
  })

  test('keeps a process item received while session selection is loading', async () => {
    request.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ items: [], hasMore: false, nextCursor: null }), 10)))
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    const selection = useWorkbenchSessionStore.getState().select('session-a')
    const { wsClient } = await import('../../ui/src/services/ws-client.js')
    const processHandler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:process_item')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    await new Promise((resolve) => setTimeout(resolve, 0))
    processHandler?.({
      sessionId: 'session-a',
      item: {
        id: 'tpi-loading-1', session_id: 'session-a', message_id: 'message-live', sequence: 1, kind: 'thinking', status: 'running', title: 'thinking', summary: 'loading', preview: 'loading', content: 'loading', meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false,
      },
    })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks).toHaveLength(1)
    await selection
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks).toHaveLength(1)
  })

  test('recovers an active process item even before the running message is visible', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    useWorkbenchSessionStore.setState({ messages: [], running: false })
    const { wsClient } = await import('../../ui/src/services/ws-client.js')
    const processHandler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:process_item')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    processHandler?.({
      sessionId: 'session-a',
      item: {
        id: 'tpi-active-1', session_id: 'session-a', message_id: 'message-live', sequence: 1, kind: 'tool', status: 'in_progress', title: '执行检查', summary: null, preview: null, content: null, meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false,
      },
    })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks).toHaveLength(1)
    expect(useWorkbenchSessionStore.getState().running).toBe(true)
  })

  test('deduplicates a canonical tool item against either realtime delivery order', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    const { wsClient } = await import('../../ui/src/services/ws-client.js')
    const processHandler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:process_item')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    const updateHandler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:update')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    updateHandler?.({ sessionId: 'session-a', data: { messageId: 'message-live', role: 'agent', toolCall: { id: 'tool-live', title: '执行检查', status: 'in_progress' } } })
    processHandler?.({
      sessionId: 'session-a',
      item: {
        id: 'tpi-tool-1', session_id: 'session-a', message_id: 'message-live', sequence: 1, kind: 'tool', status: 'in_progress', title: '执行检查', summary: null, preview: null, content: null, meta_json: JSON.stringify({ toolCallId: 'tool-live' }), detail_json: null, created_at: '', updated_at: '', has_detail: false,
      },
    })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks.filter((block) => block.kind === 'tool')).toHaveLength(1)
  })

  test('updates a loaded process snapshot when a later canonical item arrives', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    useWorkbenchSessionStore.setState({
      processByMessageId: {
        'message-live': {
          blocks: [], loading: false, loaded: true,
        },
      },
    })
    const { wsClient } = await import('../../ui/src/services/ws-client.js')
    const processHandler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:process_item')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    processHandler?.({
      sessionId: 'session-a',
      item: {
        id: 'tpi-late-1', session_id: 'session-a', message_id: 'message-live', sequence: 1, kind: 'thinking', status: 'completed', title: 'thinking', summary: 'late', preview: 'late', content: 'late', meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false,
      },
    })
    expect(useWorkbenchSessionStore.getState().processByMessageId['message-live']?.blocks).toHaveLength(1)
  })

  test('does not let a stale process RPC overwrite a realtime process item', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    let resolveProcess: ((value: unknown) => void) | undefined
    wsRequest.mockImplementationOnce(() => new Promise((resolve) => { resolveProcess = resolve }))
    const processPromise = useWorkbenchSessionStore.getState().loadMessageProcess('message-a')
    const { wsClient } = await import('../../ui/src/services/ws-client.js')
    const processHandler = wsClient.on.mock.calls.find(([eventType]) => eventType === 'session:process_item')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    processHandler?.({
      sessionId: 'session-a',
      item: {
        id: 'tpi-race-1', session_id: 'session-a', message_id: 'message-a', sequence: 2, kind: 'thinking', status: 'completed', title: 'thinking', summary: 'realtime', preview: 'realtime', content: 'realtime', meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false,
      },
    })
    resolveProcess?.([])
    await processPromise
    expect(useWorkbenchSessionStore.getState().messages.find((item) => item.id === 'message-a')?.processBlocks).toHaveLength(1)
    expect(useWorkbenchSessionStore.getState().processByMessageId['message-a']?.blocks).toHaveLength(1)
  })

  test('preserves a newer canonical block when history returns the same stale item id', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    useWorkbenchSessionStore.setState((state) => ({
      messages: state.messages.map((item) => item.id === 'message-a' ? {
        ...item,
        processBlocks: [{ id: 'tpi-same', kind: 'thinking' as const, text: 'newer realtime', sequence: 1 }],
      } : item),
    }))
    wsRequest.mockResolvedValueOnce([{
      id: 'tpi-same', session_id: 'session-a', message_id: 'message-a', sequence: 1, kind: 'thinking', status: 'completed', title: 'thinking', summary: 'stale history', preview: 'stale history', content: 'stale history', meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false,
    }])
    await useWorkbenchSessionStore.getState().loadMessageProcess('message-a')
    expect(useWorkbenchSessionStore.getState().messages.find((item) => item.id === 'message-a')?.processBlocks?.[0]).toMatchObject({ text: 'newer realtime' })
    expect(useWorkbenchSessionStore.getState().processByMessageId['message-a']?.blocks[0]).toMatchObject({ text: 'newer realtime' })
  })

  test('loads process items when a selected session has a running agent message', async () => {
    request.mockResolvedValueOnce({ items: [{ id: 'running-message', session_id: 'session-a', role: 'agent', content: '处理中', thinking: null, tool_calls_json: '{}', decision_json: null, timestamp: '2026-08-30T00:00:00.000Z', status: 'running', process_item_count: 1, has_tool_calls: true }], hasMore: false, nextCursor: null })
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    wsRequest.mockResolvedValueOnce({})
    wsRequest.mockResolvedValueOnce([{ id: 'process-1', session_id: 'session-a', message_id: 'running-message', sequence: 1, kind: 'tool', status: 'in_progress', title: '执行检查', summary: null, preview: null, content: null, meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false }])
    await useWorkbenchSessionStore.getState().select('session-a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wsRequest).toHaveBeenCalledWith({ type: 'sessions.messageProcess', sessionId: 'session-a', messageId: 'running-message' })
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks[0]).toMatchObject({ id: 'process-1', kind: 'tool', toolCall: { title: '执行检查' } })
  })

  test('restores active tool blocks from recovery events for a running message', async () => {
    request.mockResolvedValueOnce({ items: [{ id: 'running-message', session_id: 'session-a', role: 'agent', content: '', thinking: null, tool_calls_json: '{}', decision_json: null, timestamp: '2026-08-30T00:00:00.000Z', status: 'running', process_item_count: 1, has_tool_calls: true }], hasMore: false, nextCursor: null })
    getRecovery.mockResolvedValueOnce({
      sessionId: 'session-a', latestSequence: 1,
      events: [{ id: 'event-tool', session_id: 'session-a', message_id: 'running-message', type: 'tool.call', payload_json: JSON.stringify({ messageId: 'running-message', toolCall: { id: 'tool-live', title: '执行检查', status: 'in_progress' } }), sequence: 1, created_at: '2026-08-30T00:00:01Z' }],
    })
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks[0]).toMatchObject({ kind: 'tool', toolCall: { id: 'tool-live', title: '执行检查' } })
  })

  test('keeps cancellation state scoped to the session until its idle event', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    await useWorkbenchSessionStore.getState().cancel()
    expect(useWorkbenchSessionStore.getState().stopping).toBe(true)
    await useWorkbenchSessionStore.getState().select('session-b')
    expect(useWorkbenchSessionStore.getState().stopping).toBe(false)
    await useWorkbenchSessionStore.getState().select('session-a')
    expect(useWorkbenchSessionStore.getState().stopping).toBe(true)
    const activity = on.mock.calls.find(([type]) => type === 'session:activity')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    activity?.({ sessionId: 'session-a', state: 'idle' })
    expect(useWorkbenchSessionStore.getState().stopping).toBe(false)
  })

  test('updates capabilities from a realtime capability snapshot', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')

    const handler = on.mock.calls.find(([eventType]) => eventType === 'session:capabilities')?.[1] as ((message: Record<string, unknown>) => void) | undefined
    expect(handler).toBeDefined()
    handler?.({
      sessionId: 'session-a',
      capabilities: {
        models: [{ modelId: 'model-max', name: 'Max' }],
        currentModelId: 'model-max',
        modes: [{ modeId: 'plan', name: 'Plan' }],
        currentModeId: 'plan',
        supportsImages: true,
        configOptions: [],
        commands: [],
      },
    })

    expect(useWorkbenchSessionStore.getState().capabilities.currentModelId).toBe('model-max')
    expect(useWorkbenchSessionStore.getState().capabilities.currentModeId).toBe('plan')
    expect(useWorkbenchSessionStore.getState().capabilities.models).toHaveLength(1)
  })

  test('loads older pages through the adapter without changing the selected session', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    request.mockResolvedValueOnce({ items: [{ id: 'new', session_id: 'session-a', role: 'agent', content: 'new', thinking: null, tool_calls_json: null, decision_json: null, timestamp: '2026-08-30T00:00:00.000Z' }], hasMore: true, nextCursor: null })
    await useWorkbenchSessionStore.getState().select('session-a')
    request.mockResolvedValueOnce({ items: [{ id: 'old', session_id: 'session-a', role: 'human', content: 'old', thinking: null, tool_calls_json: null, decision_json: null, timestamp: '2026-08-29T00:00:00.000Z' }], hasMore: false, nextCursor: null })
    await useWorkbenchSessionStore.getState().loadOlderMessages()
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'session-a', before: '2026-08-30T00:00:00.000Z' }))
    expect(useWorkbenchSessionStore.getState().messages.map((message) => message.id)).toEqual(['old', 'new'])
    expect(useWorkbenchSessionStore.getState().hasMoreMessages).toBe(false)
  })

  test('sends image and uploaded-file attachments through the workbench adapter', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    await useWorkbenchSessionStore.getState().sendPrompt('检查附件', [{ data: 'base64', mimeType: 'image/png', name: 'shot.png' }], [{ id: 'file-1', name: 'report.md', mimeType: 'text/markdown', size: 12, path: 'uploads/report.md', relativePath: 'uploads/report.md' }])
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'prompt', images: [{ data: 'base64', mimeType: 'image/png' }], content: expect.stringContaining('uploads/report.md') }))
  })

  test('loads a historical process into the selected message', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    request.mockResolvedValueOnce({ items: [{ id: 'message-tool', session_id: 'session-a', role: 'agent', content: 'done', thinking: null, tool_calls_json: '{}', decision_json: null, timestamp: '2026-08-30T00:00:00.000Z', process_item_count: 1, has_tool_calls: true }], hasMore: false, nextCursor: null })
    await useWorkbenchSessionStore.getState().select('session-a')
    wsRequest.mockResolvedValueOnce([{ id: 'process-1', session_id: 'session-a', message_id: 'message-tool', sequence: 1, kind: 'tool', status: 'completed', title: '读取文件', summary: null, preview: null, content: null, meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false }])
    await useWorkbenchSessionStore.getState().loadMessageProcess('message-tool')
    expect(wsRequest).toHaveBeenCalledWith({ type: 'sessions.messageProcess', sessionId: 'session-a', messageId: 'message-tool' })
    expect(useWorkbenchSessionStore.getState().messages[0]?.processBlocks?.[0]).toMatchObject({ kind: 'tool' })
  })

  test('loads a historical tool detail through its process item id', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    request.mockResolvedValueOnce({ items: [{ id: 'message-tool', session_id: 'session-a', role: 'agent', content: 'done', thinking: null, tool_calls_json: '{}', decision_json: null, timestamp: '2026-08-30T00:00:00.000Z', process_item_count: 1, has_tool_calls: true }], hasMore: false, nextCursor: null })
    await useWorkbenchSessionStore.getState().select('session-a')
    wsRequest.mockResolvedValueOnce([{ id: 'process-tool', session_id: 'session-a', message_id: 'message-tool', sequence: 1, kind: 'tool', status: 'completed', title: '执行检查', summary: null, preview: null, content: null, meta_json: JSON.stringify({ toolCallId: 'tool-call-real' }), detail_json: null, created_at: '', updated_at: '', has_detail: true }])
    await useWorkbenchSessionStore.getState().loadMessageProcess('message-tool')
    wsRequest.mockResolvedValueOnce({ id: 'process-tool', session_id: 'session-a', message_id: 'message-tool', sequence: 1, kind: 'tool', status: 'completed', title: '执行检查', summary: null, preview: null, content: null, meta_json: JSON.stringify({ toolCallId: 'tool-call-real' }), detail_json: JSON.stringify({ id: 'tool-call-real', title: '执行检查', status: 'completed', rawInput: { path: 'README.md' }, rawOutput: 'ok', terminalOutput: 'done', progress: ['finished'] }), created_at: '', updated_at: '', has_detail: false })
    await useWorkbenchSessionStore.getState().loadProcessItemDetail('message-tool', 'process-tool')
    expect(wsRequest).toHaveBeenLastCalledWith({ type: 'sessions.processItemDetail', sessionId: 'session-a', messageId: 'message-tool', itemId: 'process-tool' })
    expect(useWorkbenchSessionStore.getState().messages[0]?.processBlocks?.[0]).toMatchObject({
      id: 'process-tool',
      kind: 'tool',
      toolCall: {
        id: 'tool-call-real',
        rawInput: { path: 'README.md' },
        rawOutput: 'ok',
        terminalOutput: 'done',
        progress: ['finished'],
      },
    })
  })

  test('merges a process item detail into the active streaming turn', async () => {
    request.mockResolvedValueOnce({ items: [{ id: 'running-message', session_id: 'session-a', role: 'agent', content: '', thinking: null, tool_calls_json: '{}', decision_json: null, timestamp: '2026-08-30T00:00:00.000Z', status: 'running', process_item_count: 1, has_tool_calls: true }], hasMore: false, nextCursor: null })
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    wsRequest.mockResolvedValueOnce([{ id: 'process-tool', session_id: 'session-a', message_id: 'running-message', sequence: 1, kind: 'tool', status: 'in_progress', title: '执行检查', summary: null, preview: null, content: null, meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: true }])
    await useWorkbenchSessionStore.getState().loadMessageProcess('running-message')
    wsRequest.mockResolvedValueOnce({ id: 'process-tool', session_id: 'session-a', message_id: 'running-message', sequence: 1, kind: 'tool', status: 'completed', title: '执行检查', summary: null, preview: null, content: null, meta_json: null, detail_json: JSON.stringify({ id: 'tool-call-real', title: '执行检查', status: 'completed', terminalOutput: 'done' }), created_at: '', updated_at: '', has_detail: false })
    await useWorkbenchSessionStore.getState().loadProcessItemDetail('running-message', 'process-tool')
    expect(useWorkbenchSessionStore.getState().streamingMessage?.processBlocks[0]).toMatchObject({ toolCall: { status: 'completed', terminalOutput: 'done' } })
  })

  test('clears process detail loading when the selected session changes mid-request', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    wsRequest.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ id: 'process-tool', session_id: 'session-a', message_id: 'message-tool', sequence: 1, kind: 'tool', status: 'completed', title: '执行检查', summary: null, preview: null, content: null, meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: false }), 10)))
    const detailPromise = useWorkbenchSessionStore.getState().loadProcessItemDetail('message-tool', 'process-tool')
    await useWorkbenchSessionStore.getState().select('session-b')
    await detailPromise
    expect(useWorkbenchSessionStore.getState().processItemLoadingByKey['message-tool:process-tool']).toBeUndefined()
  })

  test('does not write a stale process error into the newly selected session', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    let rejectProcess: ((error: Error) => void) | undefined
    wsRequest.mockImplementationOnce(() => new Promise((_, reject) => { rejectProcess = reject }))
    const processPromise = useWorkbenchSessionStore.getState().loadMessageProcess('message-a')
    await useWorkbenchSessionStore.getState().select('session-b')
    rejectProcess?.(new Error('A 过程加载失败'))
    await processPromise
    expect(useWorkbenchSessionStore.getState().processByMessageId['message-a']).toBeUndefined()
  })

  test('does not write a stale file detail error into the newly selected session', async () => {
    request.mockResolvedValueOnce({ items: [{ id: 'message-files', session_id: 'session-a', role: 'agent', content: 'done', thinking: null, tool_calls_json: null, decision_json: null, attachments_json: null, file_changes_json: null, timestamp: '2026-08-30T00:00:00.000Z', has_file_changes: true }], hasMore: false, nextCursor: null })
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    let rejectFiles: ((error: Error) => void) | undefined
    wsRequest.mockImplementationOnce(() => new Promise((_, reject) => { rejectFiles = reject }))
    const filesPromise = useWorkbenchSessionStore.getState().loadFileChanges('message-files')
    await useWorkbenchSessionStore.getState().select('session-b')
    rejectFiles?.(new Error('A 文件加载失败'))
    await filesPromise
    expect(useWorkbenchSessionStore.getState().fileChangeErrorByKey['file:message-files']).toBeUndefined()
  })

  test('does not write a stale process item detail error into the newly selected session', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    await useWorkbenchSessionStore.getState().select('session-a')
    let rejectDetail: ((error: Error) => void) | undefined
    wsRequest.mockImplementationOnce(() => new Promise((_, reject) => { rejectDetail = reject }))
    const detailPromise = useWorkbenchSessionStore.getState().loadProcessItemDetail('message-a', 'process-a')
    await useWorkbenchSessionStore.getState().select('session-b')
    rejectDetail?.(new Error('A 详情加载失败'))
    await detailPromise
    expect(useWorkbenchSessionStore.getState().processItemErrorByKey['message-a:process-a']).toBeUndefined()
  })

  test('uses process item detail RPC for a historical non-tool block', async () => {
    const { useWorkbenchSessionStore } = await import('../../ui/src/stores/workbench-session.store.js')
    request.mockResolvedValueOnce({ items: [{ id: 'message-plan', session_id: 'session-a', role: 'agent', content: 'done', thinking: null, tool_calls_json: null, decision_json: null, timestamp: '2026-08-30T00:00:00.000Z', process_item_count: 1 }], hasMore: false, nextCursor: null })
    await useWorkbenchSessionStore.getState().select('session-a')
    wsRequest.mockResolvedValueOnce([{ id: 'process-plan', session_id: 'session-a', message_id: 'message-plan', sequence: 1, kind: 'plan', status: 'completed', title: 'plan', summary: 'summary', preview: null, content: null, meta_json: null, detail_json: null, created_at: '', updated_at: '', has_detail: true }])
    await useWorkbenchSessionStore.getState().loadMessageProcess('message-plan')
    wsRequest.mockResolvedValueOnce({ id: 'process-plan', session_id: 'session-a', message_id: 'message-plan', sequence: 1, kind: 'plan', status: 'completed', title: 'plan', summary: 'loaded', preview: null, content: JSON.stringify({ plan: [{ content: 'complete', status: 'completed', priority: 'high' }] }), meta_json: null, detail_json: JSON.stringify({ plan: [{ content: 'complete', status: 'completed', priority: 'high' }] }), created_at: '', updated_at: '', has_detail: false })
    await useWorkbenchSessionStore.getState().loadProcessItemDetail('message-plan', 'process-plan')
    expect(wsRequest).toHaveBeenLastCalledWith({ type: 'sessions.processItemDetail', sessionId: 'session-a', messageId: 'message-plan', itemId: 'process-plan' })
    expect(useWorkbenchSessionStore.getState().messages[0]?.processBlocks?.[0]).toMatchObject({ summary: 'loaded' })
  })
})
