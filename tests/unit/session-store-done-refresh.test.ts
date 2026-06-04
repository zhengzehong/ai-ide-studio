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
    fileChangeDetailsByMessageId: {},
    toolCallLoadingByKey: {},
    toolCallErrorByKey: {},
    runningSessionIds: {},
    unreadSessionIds: {},
    staleSessionIds: {},
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

  test('refreshes persisted messages and events after a turn is done', async () => {
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
        expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.messages', sessionId: 'sess-refresh' })
        expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.events', sessionId: 'sess-refresh', limit: 1000 })
      })
    } finally {
      cleanup()
    }
  })

  test('does not duplicate the current turn after persisted message refresh', async () => {
    resetStore()
    wsMock.send.mockClear()
    wsMock.request.mockReset()
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      const agentMessageId = 'msg-live-agent-1'
      let humanMessageId = ''
      wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
        if (msg.type === 'sessions.messages') {
          return [
            {
              id: humanMessageId,
              session_id: 'sess-refresh',
              role: 'human',
              content: 'hello',
              thinking: null,
              tool_calls_json: null,
              decision_json: null,
              attachments_json: null,
              timestamp: '2026-06-02T00:00:00.000Z',
            },
            {
              id: agentMessageId,
              session_id: 'sess-refresh',
              role: 'agent',
              content: 'answer',
              thinking: null,
              tool_calls_json: null,
              decision_json: null,
              attachments_json: null,
              timestamp: '2026-06-02T00:00:01.000Z',
            },
          ]
        }
        return []
      })

      useSessionStore.getState().sendPrompt('hello')
      const sentPrompt = wsMock.send.mock.calls[0]?.[0] as Record<string, unknown>
      humanMessageId = sentPrompt.clientMessageId as string

      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: agentMessageId, role: 'agent', contentDelta: 'answer' },
      })
      emit('session:done', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        messageId: 'done-sess-refresh',
        stopReason: 'end_turn',
      })

      await vi.waitFor(() => {
        expect(useSessionStore.getState().messages.map((message) => message.id)).toEqual([
          humanMessageId,
          agentMessageId,
        ])
      })
    } finally {
      cleanup()
    }
  })

  test('recovers active turn events when historical messages are already loaded', async () => {
    resetStore()
    wsMock.request.mockReset()
    useSessionStore.setState({
      messages: [
        {
          id: 'msg-history-1',
          session_id: 'sess-refresh',
          role: 'agent',
          content: 'old answer',
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: null,
          timestamp: '2026-06-02T00:00:00.000Z',
        },
      ],
      runningSessionIds: { 'sess-refresh': true },
    })
    wsMock.request.mockResolvedValue([
      {
        id: 'evt-active-1',
        session_id: 'sess-refresh',
        agent_id: 'agent-1',
        acp_session_id: null,
        message_id: 'msg-active-1',
        type: 'message.chunk',
        role: 'agent',
        payload_json: JSON.stringify({ messageId: 'msg-active-1', role: 'agent', contentDelta: 'live' }),
        sequence: 1,
        created_at: '2026-06-02T00:00:01.000Z',
      },
    ])

    await useSessionStore.getState().fetchEvents('sess-refresh')

    expect(useSessionStore.getState().streamingMessage?.id).toBe('msg-active-1')
    expect(useSessionStore.getState().streamingMessage?.content).toBe('live')
  })

  test('does not clear a pending streaming placeholder for hidden lifecycle updates', async () => {
    resetStore()
    useSessionStore.setState({
      streamingMessage: {
        id: 'pending-sess-refresh-1',
        role: 'agent',
        content: '',
        thinking: '',
        toolCalls: [],
        done: false,
        stage: '正在准备 Agent...',
      },
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: {
          messageId: 'lifecycle.prompt_received-1',
          role: 'system',
          eventType: 'lifecycle.prompt_received',
          content: '正在准备 Agent...',
        },
      })

      expect(useSessionStore.getState().streamingMessage?.id).toBe('pending-sess-refresh-1')
      expect(useSessionStore.getState().streamingMessage?.stage).toBe('正在准备 Agent...')
    } finally {
      cleanup()
    }
  })

  test('does not clear a pending streaming placeholder for hidden lifecycle events', async () => {
    resetStore()
    useSessionStore.setState({
      streamingMessage: {
        id: 'pending-sess-refresh-2',
        role: 'agent',
        content: '',
        thinking: '',
        toolCalls: [],
        done: false,
        stage: '正在准备 Agent...',
      },
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:event', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        event: {
          id: 'evt-hidden-lifecycle',
          session_id: 'sess-refresh',
          agent_id: 'agent-1',
          acp_session_id: null,
          message_id: 'lifecycle.prompt_received-2',
          type: 'lifecycle.prompt_received',
          role: 'system',
          payload_json: JSON.stringify({
            messageId: 'lifecycle.prompt_received-2',
            role: 'system',
            content: '正在准备 Agent...',
          }),
          sequence: 1,
          created_at: new Date().toISOString(),
        },
      })

      expect(useSessionStore.getState().streamingMessage?.id).toBe('pending-sess-refresh-2')
      expect(useSessionStore.getState().streamingMessage?.stage).toBe('正在准备 Agent...')
    } finally {
      cleanup()
    }
  })

  test('hands off a stage-only resume placeholder to the real assistant message id', async () => {
    resetStore()
    useSessionStore.setState({
      streamingMessage: {
        id: 'lifecycle.session_resuming-1',
        role: 'agent',
        content: '',
        thinking: '',
        toolCalls: [],
        done: false,
        stage: 'resuming session...',
      },
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-real-1', role: 'agent', contentDelta: 'hello' },
      })

      await vi.waitFor(() => {
        expect(useSessionStore.getState().streamingMessage?.id).toBe('msg-real-1')
      })
      expect(useSessionStore.getState().streamingMessage?.content).toBe('hello')
      expect(useSessionStore.getState().streamingMessage?.stage).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  test('keeps active turn process blocks separate from final answer while streaming', async () => {
    resetStore()
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-active-order', role: 'agent', contentDelta: '我先检查。' },
      })
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-active-order', role: 'agent', toolCall: { id: 'tool-1', title: '读文件', status: 'completed' } },
      })
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-active-order', role: 'agent', contentDelta: '最终结论。' },
      })

      await vi.waitFor(() => {
        expect(useSessionStore.getState().streamingMessage?.finalAnswer).toBe('最终结论。')
      })
      const turn = useSessionStore.getState().streamingMessage
      expect(turn?.processBlocks.map((block) => block.kind)).toEqual(['note', 'tool'])
      expect(turn?.processBlocks[0]).toMatchObject({ kind: 'note', text: '我先检查。' })
    } finally {
      cleanup()
    }
  })

  test('collapses the just-finished turn process after completion', async () => {
    resetStore()
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-open-process', role: 'agent', contentDelta: 'inspect first.' },
      })
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-open-process', role: 'agent', toolCall: { id: 'tool-open', title: 'Read file', status: 'completed' } },
      })
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-open-process', role: 'agent', contentDelta: 'final answer.' },
      })
      emit('session:done', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        messageId: 'done-sess-refresh',
        stopReason: 'end_turn',
      })

      await vi.waitFor(() => {
        expect(useSessionStore.getState().messages.find((message) => message.id === 'msg-open-process')?.processBlocks?.length).toBeGreaterThan(0)
        expect(useSessionStore.getState().messages.find((message) => message.id === 'msg-open-process')?.processDefaultOpen).toBeUndefined()
      })
    } finally {
      cleanup()
    }
  })

  test('does not keep lifecycle-only status as a completed execution process', async () => {
    resetStore()
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: {
          messageId: 'lifecycle.prompt_sent-1',
          role: 'system',
          eventType: 'lifecycle.prompt_sent',
          content: 'thinking...',
        },
      })
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-stage-only', role: 'agent', contentDelta: 'hello' },
      })
      emit('session:done', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        messageId: 'done-sess-refresh',
        stopReason: 'end_turn',
      })

      await vi.waitFor(() => {
        expect(useSessionStore.getState().messages.find((message) => message.id === 'msg-stage-only')?.content).toBe('hello')
      })
      const message = useSessionStore.getState().messages.find((item) => item.id === 'msg-stage-only')
      expect(message?.processBlocks).toEqual([])
      expect(message?.processDefaultOpen).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  test('marks background session running, unread after idle, and read after selecting it', async () => {
    resetStore()
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:activity', {
        sessionId: 'sess-bg',
        agentId: 'agent-1',
        state: 'running',
        reason: 'prompt-started',
        timestamp: '2026-06-03T00:00:00.000Z',
      })

      expect(useSessionStore.getState().runningSessionIds['sess-bg']).toBe(true)
      expect(useSessionStore.getState().unreadSessionIds['sess-bg']).toBeUndefined()

      emit('session:activity', {
        sessionId: 'sess-bg',
        agentId: 'agent-1',
        state: 'idle',
        reason: 'prompt-done',
        timestamp: '2026-06-03T00:00:01.000Z',
      })

      expect(useSessionStore.getState().runningSessionIds['sess-bg']).toBeUndefined()
      expect(useSessionStore.getState().unreadSessionIds['sess-bg']).toBe(true)
      expect(useSessionStore.getState().staleSessionIds['sess-bg']).toBe(true)

      useSessionStore.getState().selectSession('sess-bg')

      expect(useSessionStore.getState().unreadSessionIds['sess-bg']).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  test('does not restore stale streaming when switching back to a background session that became idle', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockResolvedValue([])
    useSessionStore.setState({
      streamingMessage: {
        id: 'msg-bg-live',
        role: 'agent',
        content: 'partial',
        thinking: '',
        toolCalls: [],
        done: false,
      },
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      useSessionStore.getState().selectSession('sess-other')
      emit('session:activity', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        state: 'idle',
        reason: 'prompt-done',
        timestamp: '2026-06-03T00:00:01.000Z',
      })

      useSessionStore.getState().selectSession('sess-refresh')

      expect(useSessionStore.getState().streamingMessage).toBeNull()
      expect(useSessionStore.getState().staleSessionIds['sess-refresh']).toBe(true)
    } finally {
      cleanup()
    }
  })

  test('clears stale streaming after persisted final messages are loaded', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockResolvedValue([
      {
        id: 'msg-human-final',
        session_id: 'sess-refresh',
        role: 'human',
        content: 'hello',
        thinking: null,
        tool_calls_json: null,
        decision_json: null,
        attachments_json: null,
        timestamp: '2026-06-02T00:00:00.000Z',
      },
      {
        id: 'msg-agent-final',
        session_id: 'sess-refresh',
        role: 'agent',
        content: 'done',
        thinking: null,
        tool_calls_json: null,
        decision_json: null,
        attachments_json: null,
        timestamp: '2026-06-02T00:00:01.000Z',
      },
    ])
    useSessionStore.setState({
      streamingMessage: {
        id: 'pending-sess-refresh-stale',
        role: 'agent',
        content: 'partial',
        thinking: '',
        toolCalls: [],
        done: false,
      },
      staleSessionIds: { 'sess-refresh': true },
    })

    await useSessionStore.getState().fetchMessages('sess-refresh')

    expect(useSessionStore.getState().streamingMessage).toBeNull()
    expect(useSessionStore.getState().staleSessionIds['sess-refresh']).toBeUndefined()
    expect(useSessionStore.getState().messages.map((message) => message.id)).toEqual(['msg-human-final', 'msg-agent-final'])
  })

  test('does not keep old streaming when stale events do not recover an active running turn', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockResolvedValue([
      {
        id: 'evt-stale-chunk',
        session_id: 'sess-refresh',
        agent_id: 'agent-1',
        acp_session_id: null,
        message_id: 'msg-stale-live',
        type: 'message.chunk',
        role: 'agent',
        payload_json: JSON.stringify({ messageId: 'msg-stale-live', role: 'agent', contentDelta: 'old live' }),
        sequence: 1,
        created_at: '2026-06-02T00:00:01.000Z',
      },
    ])
    useSessionStore.setState({
      messages: [
        {
          id: 'msg-history-1',
          session_id: 'sess-refresh',
          role: 'agent',
          content: 'old answer',
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: null,
          timestamp: '2026-06-02T00:00:00.000Z',
        },
      ],
      streamingMessage: {
        id: 'msg-old-streaming',
        role: 'agent',
        content: 'stuck',
        thinking: '',
        toolCalls: [],
        done: false,
      },
      staleSessionIds: { 'sess-refresh': true },
    })

    await useSessionStore.getState().fetchEvents('sess-refresh')

    expect(useSessionStore.getState().streamingMessage).toBeNull()
  })

})
