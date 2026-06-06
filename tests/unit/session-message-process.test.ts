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
    processItemLoadingByKey: {},
    processItemErrorByKey: {},
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


  test('loads one process item detail and merges it into the message process block', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'sessions.processItemDetail') {
        return {
          id: 'tpi-tool-1',
          session_id: 'sess-process',
          message_id: 'msg-agent-1',
          sequence: 1,
          kind: 'tool',
          status: 'completed',
          title: 'filesystem.read_text_file src/app.ts',
          summary: 'read file',
          preview: 'src/app.ts',
          content: null,
          detail_json: JSON.stringify({ id: 'tool-1', title: 'filesystem.read_text_file src/app.ts', status: 'completed', rawOutput: 'file content' }),
          meta_json: null,
          created_at: '2026-06-03T00:00:01.000Z',
          updated_at: '2026-06-03T00:00:02.000Z',
          has_detail: true,
        }
      }
      return []
    })
    useSessionStore.setState({
      messages: [
        {
          id: 'msg-agent-1',
          session_id: 'sess-process',
          role: 'agent',
          content: '完成',
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: null,
          timestamp: '2026-06-03T00:00:04.000Z',
          processBlocks: [
            { id: 'tpi-tool-1', kind: 'tool', toolCall: { id: 'tool-1', title: 'filesystem.read_text_file src/app.ts', status: 'completed' }, sequence: 1, hasDetail: true },
          ],
        },
      ],
    })

    await useSessionStore.getState().fetchProcessItemDetail('sess-process', 'msg-agent-1', 'tpi-tool-1')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.processItemDetail', sessionId: 'sess-process', messageId: 'msg-agent-1', itemId: 'tpi-tool-1' })
    const block = useSessionStore.getState().messages[0].processBlocks?.[0]
    expect(block).toMatchObject({ kind: 'tool', toolCall: { id: 'tool-1', rawOutput: 'file content' } })
  })


  test('clears process item loading when detail response arrives after switching sessions', async () => {
    resetStore()
    wsMock.request.mockReset()
    let resolveRequest: (value: unknown) => void = () => undefined
    wsMock.request.mockImplementation(async () => new Promise((resolve) => {
      resolveRequest = resolve
    }))
    useSessionStore.setState({
      currentSessionId: 'sess-process',
      messages: [
        {
          id: 'msg-agent-1',
          session_id: 'sess-process',
          role: 'agent',
          content: '??',
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: null,
          timestamp: '2026-06-03T00:00:04.000Z',
          processBlocks: [
            { id: 'tpi-tool-1', kind: 'tool', toolCall: { id: 'tool-1', title: 'filesystem.read_text_file src/app.ts' }, sequence: 1, hasDetail: true },
          ],
        },
      ],
    })

    const request = useSessionStore.getState().fetchProcessItemDetail('sess-process', 'msg-agent-1', 'tpi-tool-1')
    expect(useSessionStore.getState().processItemLoadingByKey['msg-agent-1:tpi-tool-1']).toBe(true)

    useSessionStore.setState({ currentSessionId: 'sess-other' })
    resolveRequest({
      id: 'tpi-tool-1',
      session_id: 'sess-process',
      message_id: 'msg-agent-1',
      sequence: 1,
      kind: 'tool',
      status: 'completed',
      title: 'filesystem.read_text_file src/app.ts',
      summary: 'read file',
      preview: 'src/app.ts',
      content: null,
      detail_json: JSON.stringify({ id: 'tool-1', title: 'filesystem.read_text_file src/app.ts', rawOutput: 'file content' }),
      meta_json: null,
      created_at: '2026-06-03T00:00:01.000Z',
      updated_at: '2026-06-03T00:00:02.000Z',
      has_detail: true,
    })
    await request

    expect(useSessionStore.getState().processItemLoadingByKey['msg-agent-1:tpi-tool-1']).not.toBe(true)
  })

  test('clears process item loading and errors when selecting another session', () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockResolvedValue([])
    useSessionStore.setState({
      currentSessionId: 'sess-process',
      processItemLoadingByKey: { 'msg-agent-1:tpi-tool-1': true },
      processItemErrorByKey: { 'msg-agent-1:tpi-tool-1': 'failed' },
    })

    useSessionStore.getState().selectSession('sess-other')

    expect(useSessionStore.getState().processItemLoadingByKey).toEqual({})
    expect(useSessionStore.getState().processItemErrorByKey).toEqual({})
  })

  test('loads one historical agent message process from ordered events', async () => {
    resetStore()
    wsMock.request.mockReset()
    const legacyEvents = [
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
    ]
    wsMock.request.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'sessions.messageProcess') return []
      if (request.type === 'sessions.messageEvents') return legacyEvents
      return []
    })
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

    expect(wsMock.request).toHaveBeenNthCalledWith(1, { type: 'sessions.messageProcess', sessionId: 'sess-process', messageId: 'msg-agent-1' })
    expect(wsMock.request).toHaveBeenNthCalledWith(2, { type: 'sessions.messageEvents', sessionId: 'sess-process', messageId: 'msg-agent-1' })
    const message = useSessionStore.getState().messages[0]
    expect(message.finalAnswer).toBe('最终回复。')
    expect(message.processBlocks?.map((block) => block.kind)).toEqual(['note', 'tool'])
    expect(message.processBlocks?.[0]).toMatchObject({ kind: 'note', text: '先看代码。' })
  })
})
