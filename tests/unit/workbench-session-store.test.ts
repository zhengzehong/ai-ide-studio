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
})
