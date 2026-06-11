import { beforeEach, describe, expect, test, vi } from 'vitest'
import { buildChatRenderItems } from '../../ui/src/components/chat/render-items.ts'
import { createEmptyTurn } from '../../ui/src/stores/turn-blocks.ts'
import { defaultCaps, type MessageData, type TurnProcessItemInfo } from '../../ui/src/stores/session-events.ts'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => []),
  on: vi.fn(),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('@desktop/services/ws-client', () => ({
  wsClient: wsMock,
}))

const { useChatStore } = await import('../../mobile/src/stores/chat.store.ts')

function agentMessage(overrides: Partial<MessageData> = {}): MessageData {
  return {
    id: 'msg-agent-1',
    session_id: 'sess-1',
    role: 'agent',
    content: '完成',
    thinking: null,
    tool_calls_json: null,
    decision_json: null,
    attachments_json: null,
    file_changes_json: null,
    timestamp: '2026-06-10T00:00:00.000Z',
    ...overrides,
  }
}

function processItem(overrides: Partial<TurnProcessItemInfo> = {}): TurnProcessItemInfo {
  return {
    id: 'tpi-tool-1',
    session_id: 'sess-1',
    message_id: 'msg-agent-1',
    sequence: 1,
    kind: 'tool',
    status: 'completed',
    title: 'Read file',
    summary: 'read file',
    preview: null,
    content: null,
    detail_json: JSON.stringify({ id: 'tool-1', title: 'Read file', status: 'completed' }),
    meta_json: null,
    created_at: '2026-06-10T00:00:01.000Z',
    updated_at: '2026-06-10T00:00:02.000Z',
    has_detail: false,
    ...overrides,
  }
}

function resetStore(): void {
  useChatStore.setState({
    sessionId: 'sess-1',
    messages: [],
    events: [],
    streamingMessage: null,
    plan: [],
    pendingPermissions: [],
    pendingElicitations: [],
    capabilities: { ...defaultCaps },
    usage: null,
    turnUsage: null,
    loading: false,
    isRunning: false,
    turnProcessLoadingByMessageId: {},
    turnProcessErrorByMessageId: {},
  })
  wsMock.request.mockReset()
  wsMock.request.mockResolvedValue([])
  wsMock.on.mockReset()
  wsMock.send.mockReset()
  wsMock.subscribe.mockReset()
  wsMock.unsubscribe.mockReset()
}

describe('mobile chat store', () => {
  beforeEach(() => {
    resetStore()
  })

  test('merges realtime process items into the matching persisted message', () => {
    const handlers = new Map<string, (message: Record<string, unknown>) => void>()
    wsMock.on.mockImplementation((event: string, handler: (message: Record<string, unknown>) => void) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    })
    useChatStore.setState({
      messages: [agentMessage({ process_item_count: 0 })],
      streamingMessage: createEmptyTurn('msg-agent-1'),
      isRunning: true,
    })

    const cleanup = useChatStore.getState().setupListeners()
    handlers.get('session:process_item')?.({ sessionId: 'sess-1', item: processItem() })

    const message = useChatStore.getState().messages[0]
    expect(message.processBlocks?.[0]).toMatchObject({ kind: 'tool', toolCall: { id: 'tool-1' } })
    expect(message.process_item_count).toBe(1)
    expect(useChatStore.getState().streamingMessage?.processBlocks[0]).toMatchObject({ kind: 'tool', toolCall: { id: 'tool-1' } })

    cleanup()
  })

  test('loads completed message process blocks on demand', async () => {
    wsMock.request.mockResolvedValue([processItem()])
    useChatStore.setState({
      messages: [agentMessage({ process_item_count: 1 })],
      streamingMessage: null,
      isRunning: false,
    })

    await useChatStore.getState().fetchMessageProcess('sess-1', 'msg-agent-1')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.messageProcess', sessionId: 'sess-1', messageId: 'msg-agent-1' })
    const message = useChatStore.getState().messages[0]
    expect(message.processBlocks?.[0]).toMatchObject({ kind: 'tool', toolCall: { id: 'tool-1' } })
    expect(message.finalAnswer).toBe('完成')
    expect(useChatStore.getState().streamingMessage).toBeNull()
  })

  test('restores a running message as one streaming render item without a duplicate persisted bubble', async () => {
    const startedAt = new Date(Date.now() - 12_000).toISOString()
    const running = agentMessage({
      id: 'msg-running-1',
      content: 'partial answer',
      status: 'running',
      started_at: startedAt,
      timestamp: startedAt,
    })
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.messages') return [running]
      if (msg.type === 'sessions.events') return []
      if (msg.type === 'sessions.messageProcess') return [processItem({ message_id: 'msg-running-1' })]
      return []
    })
    useChatStore.setState({ sessionId: null, messages: [], streamingMessage: null, isRunning: false })

    useChatStore.getState().enterSession('sess-1')

    await vi.waitFor(() => {
      expect(useChatStore.getState().streamingMessage?.id).toBe('msg-running-1')
    })

    const state = useChatStore.getState()
    const items = buildChatRenderItems({
      sessionId: 'sess-1',
      messages: state.messages,
      events: state.events,
      streamingBubble: state.streamingMessage ? { ...state.streamingMessage, session_id: 'sess-1' } : null,
      showStreamingBubble: !!state.streamingMessage,
      blockingInteraction: false,
    })

    expect(items.map((item) => item.kind)).toEqual(['streaming'])
  })

  test('uses a restored running message start time when finalizing elapsed seconds', async () => {
    const startedAt = new Date(Date.now() - 12_000).toISOString()
    const running = agentMessage({
      id: 'msg-running-1',
      content: 'partial answer',
      status: 'running',
      started_at: startedAt,
      timestamp: startedAt,
    })
    const handlers = new Map<string, (message: Record<string, unknown>) => void>()
    wsMock.on.mockImplementation((event: string, handler: (message: Record<string, unknown>) => void) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    })
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.messages') return [running]
      if (msg.type === 'sessions.events') return []
      if (msg.type === 'sessions.messageProcess') return []
      return []
    })
    useChatStore.setState({ sessionId: null, messages: [], streamingMessage: null, isRunning: false })
    const cleanup = useChatStore.getState().setupListeners()

    useChatStore.getState().enterSession('sess-1')

    await vi.waitFor(() => {
      expect(useChatStore.getState().streamingMessage?.id).toBe('msg-running-1')
    })
    handlers.get('session:done')?.({
      type: 'session:done',
      sessionId: 'sess-1',
      messageId: 'msg-running-1',
      turnUsage: { inputTokens: 1, outputTokens: 2 },
    })

    await vi.waitFor(() => {
      const finalized = useChatStore.getState().messages.find((message) => message.id === 'msg-running-1')
      const stats = finalized?.decision_json ? JSON.parse(finalized.decision_json) as { elapsedSeconds?: number } : {}
      expect(stats.elapsedSeconds).toBeGreaterThanOrEqual(10)
    })

    cleanup()
  })
})
