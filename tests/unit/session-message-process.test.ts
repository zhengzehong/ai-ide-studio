import { describe, expect, test, vi } from 'vitest'
import { defaultCaps } from '../../ui/src/stores/session-events.ts'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => []),
  on: vi.fn(() => () => undefined),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../../ui/src/services/ws-client', () => ({
  wsClient: wsMock,
}))

const { useSessionStore } = await import('../../ui/src/stores/session.store.ts')

function resetStore(): void {
  useSessionStore.setState({
    sessions: [],
    currentSessionId: 'sess-process',
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
    fileChangeDetailsByMessageId: {},
    toolCallLoadingByKey: {},
    toolCallErrorByKey: {},
    turnProcessLoadingByMessageId: {},
    turnProcessErrorByMessageId: {},
    runningSessionIds: {},
    unreadSessionIds: {},
    staleSessionIds: {},
  })
}

describe('session store message process loading', () => {
  test('deduplicates file-change detail loads while a request is in flight', async () => {
    resetStore()
    wsMock.request.mockReset()
    let resolveRequest: (value: unknown) => void = () => undefined
    wsMock.request.mockImplementation(async () => new Promise((resolve) => {
      resolveRequest = resolve
    }))

    const first = useSessionStore.getState().fetchMessageFileChanges('sess-process', 'msg-agent-1')
    const second = useSessionStore.getState().fetchMessageFileChanges('sess-process', 'msg-agent-1')

    expect(wsMock.request).toHaveBeenCalledTimes(1)
    resolveRequest({ files: [], totalAdded: 0, totalDeleted: 0 })
    await Promise.all([first, second])
  })

  test('loads one historical agent message process from ordered events', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockResolvedValue([
      {
        id: 'evt-1',
        session_id: 'sess-process',
        agent_id: 'agent-1',
        acp_session_id: null,
        message_id: 'msg-agent-1',
        type: 'message.chunk',
        role: 'agent',
        payload_json: JSON.stringify({ messageId: 'msg-agent-1', role: 'agent', contentDelta: '先看代码。' }),
        sequence: 1,
        created_at: '2026-06-03T00:00:01.000Z',
      },
      {
        id: 'evt-2',
        session_id: 'sess-process',
        agent_id: 'agent-1',
        acp_session_id: null,
        message_id: 'msg-agent-1',
        type: 'tool.call',
        role: 'agent',
        payload_json: JSON.stringify({ messageId: 'msg-agent-1', toolCall: { id: 'tool-1', title: 'Read file', status: 'completed' } }),
        sequence: 2,
        created_at: '2026-06-03T00:00:02.000Z',
      },
      {
        id: 'evt-3',
        session_id: 'sess-process',
        agent_id: 'agent-1',
        acp_session_id: null,
        message_id: 'msg-agent-1',
        type: 'message.chunk',
        role: 'agent',
        payload_json: JSON.stringify({ messageId: 'msg-agent-1', role: 'agent', contentDelta: '最终回复。' }),
        sequence: 3,
        created_at: '2026-06-03T00:00:03.000Z',
      },
    ])
    useSessionStore.setState({
      messages: [
        {
          id: 'msg-agent-1',
          session_id: 'sess-process',
          role: 'agent',
          content: '最终回复。',
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: null,
          timestamp: '2026-06-03T00:00:04.000Z',
          has_tool_calls: true,
          tool_call_count: 1,
        },
      ],
    })

    await useSessionStore.getState().fetchMessageProcess('sess-process', 'msg-agent-1')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.messageEvents', sessionId: 'sess-process', messageId: 'msg-agent-1' })
    const message = useSessionStore.getState().messages[0]
    expect(message.finalAnswer).toBe('最终回复。')
    expect(message.processBlocks?.map((block) => block.kind)).toEqual(['note', 'tool'])
    expect(message.processBlocks?.[0]).toMatchObject({ kind: 'note', text: '先看代码。' })
  })
})
