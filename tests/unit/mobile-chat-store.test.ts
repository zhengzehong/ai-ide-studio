import { beforeEach, describe, expect, test, vi } from 'vitest'
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
})
