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

const { useSessionStore, readStoredSessionId } = await import('../../ui/src/stores/session.store.ts')

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
  test('refreshes persisted messages after a turn is done without default event timeline loading', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.messages') {
        return [{
          id: 'msg-agent-final',
          session_id: 'sess-refresh',
          role: 'agent',
          content: 'answer',
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: null,
          timestamp: '2026-06-02T00:00:00.000Z',
        }]
      }
      return []
    })
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
      })
      expect(wsMock.request).not.toHaveBeenCalledWith({ type: 'sessions.events', sessionId: 'sess-refresh', limit: 1000 })
    } finally {
      cleanup()
    }
  })

  test('falls back to event recovery only when message history is empty', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockResolvedValue([])
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
        data: { messageId: 'msg-active-order', role: 'agent', contentDelta: 'I will inspect first' },
      })
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-active-order', role: 'agent', toolCall: { id: 'tool-1', title: 'read file', status: 'completed' } },
      })
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-active-order', role: 'agent', contentDelta: 'Final answer' },
      })

      await vi.waitFor(() => {
        expect(useSessionStore.getState().streamingMessage?.finalAnswer).toBe('Final answer')
      })
      const turn = useSessionStore.getState().streamingMessage
      expect(turn?.processBlocks.map((block) => block.kind)).toEqual(['note', 'tool'])
      expect(turn?.processBlocks[0]).toMatchObject({ kind: 'note', text: 'I will inspect first' })
    } finally {
      cleanup()
    }
  })

  test('does not duplicate canonical thinking process items with mirrored session updates', async () => {
    resetStore()
    useSessionStore.setState({
      streamingMessage: {
        id: 'msg-thinking-1',
        role: 'agent',
        content: '',
        thinking: '',
        toolCalls: [],
        processBlocks: [],
        finalAnswer: '',
        done: false,
      },
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:process_item', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        item: {
          id: 'tpi-thinking-1',
          session_id: 'sess-refresh',
          message_id: 'msg-thinking-1',
          sequence: 1,
          kind: 'thinking',
          status: 'running',
          title: 'Thinking',
          summary: 'thinking',
          preview: 'thinking',
          content: 'thinking',
          meta_json: null,
          created_at: '2026-06-02T00:00:00.000Z',
          updated_at: '2026-06-02T00:00:00.000Z',
          has_detail: false,
        },
      })
      emit('session:update', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        data: { messageId: 'msg-thinking-1', role: 'agent', thinking: 'thinking' },
      })

      expect(useSessionStore.getState().streamingMessage?.processBlocks).toHaveLength(1)
      expect(useSessionStore.getState().streamingMessage?.thinking).toBe('thinking')
    } finally {
      cleanup()
    }
  })

  test('hands off a pending placeholder when the first canonical process item arrives', async () => {
    resetStore()
    useSessionStore.setState({
      runningSessionIds: { 'sess-refresh': true },
      streamingMessage: {
        id: 'pending-sess-refresh-process',
        role: 'agent',
        content: '',
        thinking: '',
        toolCalls: [],
        processBlocks: [{ id: 'turn-stage-0', kind: 'stage', text: '正在准备 Agent...' }],
        finalAnswer: '',
        done: false,
        stage: 'Preparing Agent...',
      },
    })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:process_item', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        item: {
          id: 'tpi-thinking-first',
          session_id: 'sess-refresh',
          message_id: 'msg-real-process-1',
          sequence: 2,
          kind: 'thinking',
          status: 'running',
          title: 'Thinking',
          summary: 'thinking',
          preview: 'thinking',
          content: 'thinking',
          meta_json: null,
          created_at: '2026-06-02T00:00:00.000Z',
          updated_at: '2026-06-02T00:00:00.000Z',
          has_detail: false,
        },
      })

      expect(useSessionStore.getState().streamingMessage?.id).toBe('msg-real-process-1')
      expect(useSessionStore.getState().streamingMessage?.thinking).toBe('thinking')
      expect(useSessionStore.getState().streamingMessage?.processBlocks.map((block) => block.kind)).toEqual(['stage', 'thinking'])
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


  test('restores running indicators from session list runtime state', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.list') {
        return [
          {
            id: 'sess-refresh',
            agent_id: 'agent-1',
            task_id: null,
            acp_session_id: null,
            status: 'active',
            stage: '',
            started_at: '2026-06-03T00:00:00.000Z',
            closed_at: null,
            project_id: 'proj-1',
            activity_state: 'running',
          },
          {
            id: 'sess-stale',
            agent_id: 'agent-1',
            task_id: null,
            acp_session_id: null,
            status: 'active',
            stage: '',
            started_at: '2026-06-03T00:00:00.000Z',
            closed_at: null,
            project_id: 'proj-1',
            activity_state: 'idle',
          },
        ]
      }
      return []
    })
    useSessionStore.setState({ runningSessionIds: { 'sess-stale': true } })

    await useSessionStore.getState().fetchSessions(undefined, 'proj-1')

    expect(useSessionStore.getState().runningSessionIds).toEqual({ 'sess-refresh': true })
  })

  test('does not clear running indicator on done when refreshed messages still show a running agent turn', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.messages') {
        return [
          {
            id: 'msg-running-agent',
            session_id: 'sess-refresh',
            role: 'agent',
            content: '',
            thinking: null,
            tool_calls_json: null,
            decision_json: null,
            attachments_json: null,
            file_changes_json: null,
            status: 'running',
            timestamp: '2026-06-03T00:00:01.000Z',
          },
        ]
      }
      return []
    })
    useSessionStore.setState({ runningSessionIds: { 'sess-refresh': true } })
    const cleanup = useSessionStore.getState().setupListeners()

    try {
      emit('session:done', {
        sessionId: 'sess-refresh',
        agentId: 'agent-1',
        messageId: 'cancel-timeout-1',
        stopReason: 'cancelled',
      })

      await vi.waitFor(() => {
        expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.messages', sessionId: 'sess-refresh' })
      })
      expect(useSessionStore.getState().runningSessionIds['sess-refresh']).toBe(true)
      expect(useSessionStore.getState().staleSessionIds['sess-refresh']).toBeUndefined()
    } finally {
      cleanup()
    }
  })


  test('clears running indicator after done when refreshed messages have no running agent turn', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.messages') {
        return [
          {
            id: 'msg-completed-agent',
            session_id: 'sess-refresh',
            role: 'agent',
            content: 'done',
            thinking: null,
            tool_calls_json: null,
            decision_json: null,
            attachments_json: null,
            file_changes_json: null,
            status: 'completed',
            timestamp: '2026-06-03T00:00:02.000Z',
          },
        ]
      }
      return []
    })
    useSessionStore.setState({ runningSessionIds: { 'sess-refresh': true } })
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
      })
      expect(useSessionStore.getState().runningSessionIds['sess-refresh']).toBeUndefined()
      expect(useSessionStore.getState().staleSessionIds['sess-refresh']).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  test('turns background done into unread stale state instead of leaving a stale running indicator', async () => {
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

      emit('session:done', {
        sessionId: 'sess-bg',
        agentId: 'agent-1',
        messageId: 'done-sess-bg',
        stopReason: 'end_turn',
      })

      expect(useSessionStore.getState().runningSessionIds['sess-bg']).toBeUndefined()
      expect(useSessionStore.getState().unreadSessionIds['sess-bg']).toBe(true)
      expect(useSessionStore.getState().staleSessionIds['sess-bg']).toBe(true)
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

  test('restores cached messages immediately when switching back to a session', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockResolvedValue([])
    useSessionStore.setState({
      messages: [
        {
          id: 'msg-cached',
          session_id: 'sess-refresh',
          role: 'agent',
          content: 'cached answer',
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: null,
          timestamp: '2026-06-02T00:00:00.000Z',
        },
      ],
    })

    useSessionStore.getState().selectSession('sess-other')
    expect(useSessionStore.getState().messages).toEqual([])

    useSessionStore.getState().selectSession('sess-refresh')

    expect(useSessionStore.getState().messages.map((message) => message.id)).toEqual(['msg-cached'])
  })

  test('restores a running message as streaming with complete process after switching back', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.messages') {
        return [
          {
            id: 'msg-human-running',
            session_id: 'sess-refresh',
            role: 'human',
            content: 'please inspect',
            thinking: null,
            tool_calls_json: null,
            decision_json: null,
            attachments_json: null,
            timestamp: '2026-06-02T00:00:00.000Z',
          },
          {
            id: 'msg-agent-running',
            session_id: 'sess-refresh',
            role: 'agent',
            content: 'partial answer',
            thinking: null,
            tool_calls_json: null,
            decision_json: null,
            attachments_json: null,
            timestamp: '2026-06-02T00:00:01.000Z',
            status: 'running',
            process_item_count: 3,
          },
        ]
      }
      if (msg.type === 'sessions.messageProcess') {
        return [
          {
            id: 'tpi-note-1',
            session_id: 'sess-refresh',
            message_id: 'msg-agent-running',
            sequence: 1,
            kind: 'note',
            status: 'completed',
            title: 'note',
            summary: 'look around',
            preview: 'look around',
            content: 'look around',
            meta_json: null,
            created_at: '2026-06-02T00:00:01.000Z',
            updated_at: '2026-06-02T00:00:01.000Z',
            has_detail: false,
          },
          {
            id: 'tpi-tool-1',
            session_id: 'sess-refresh',
            message_id: 'msg-agent-running',
            sequence: 2,
            kind: 'tool',
            status: 'running',
            title: 'filesystem.read_text_file src/app.ts',
            summary: 'read file',
            preview: 'src/app.ts',
            content: null,
            meta_json: null,
            created_at: '2026-06-02T00:00:02.000Z',
            updated_at: '2026-06-02T00:00:02.000Z',
            has_detail: true,
          },
          {
            id: 'tpi-thinking-1',
            session_id: 'sess-refresh',
            message_id: 'msg-agent-running',
            sequence: 3,
            kind: 'thinking',
            status: 'running',
            title: 'thinking',
            summary: 'still thinking',
            preview: 'still thinking',
            content: 'still thinking',
            meta_json: null,
            created_at: '2026-06-02T00:00:03.000Z',
            updated_at: '2026-06-02T00:00:03.000Z',
            has_detail: false,
          },
        ]
      }
      return []
    })
    useSessionStore.setState({ runningSessionIds: { 'sess-refresh': true } })

    useSessionStore.getState().selectSession('sess-other')
    useSessionStore.getState().selectSession('sess-refresh')

    await vi.waitFor(() => {
      expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.messageProcess', sessionId: 'sess-refresh', messageId: 'msg-agent-running' })
    })

    const state = useSessionStore.getState()
    expect(state.streamingMessage?.id).toBe('msg-agent-running')
    expect(state.streamingMessage?.done).toBe(false)
    expect(state.streamingMessage?.finalAnswer).toBe('partial answer')
    expect(state.streamingMessage?.processBlocks.map((block) => block.kind)).toEqual(['note', 'tool', 'thinking'])
    expect(state.messages.find((message) => message.id === 'msg-agent-running')?.processBlocks).toHaveLength(3)
  })

  test('restores a running message as streaming even before process items exist', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.messages') {
        return [
          {
            id: 'msg-agent-running-empty-process',
            session_id: 'sess-refresh',
            role: 'agent',
            content: 'partial answer',
            thinking: null,
            tool_calls_json: null,
            decision_json: null,
            attachments_json: null,
            timestamp: '2026-06-02T00:00:01.000Z',
            status: 'running',
            process_item_count: 0,
          },
        ]
      }
      if (msg.type === 'sessions.messageProcess') return []
      return []
    })
    useSessionStore.setState({ runningSessionIds: { 'sess-refresh': true } })

    useSessionStore.getState().selectSession('sess-refresh')

    await vi.waitFor(() => {
      expect(useSessionStore.getState().messages.map((message) => message.id)).toEqual(['msg-agent-running-empty-process'])
    })

    const state = useSessionStore.getState()
    expect(state.streamingMessage?.id).toBe('msg-agent-running-empty-process')
    expect(state.streamingMessage?.done).toBe(false)
    expect(state.streamingMessage?.finalAnswer).toBe('partial answer')
  })

  test('keeps cached running streaming visible while refreshing the same running message', async () => {
    resetStore()
    wsMock.request.mockReset()
    let resolveProcess: (value: unknown) => void = () => undefined
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.messages') {
        return [
          {
            id: 'msg-agent-running-visible',
            session_id: 'sess-refresh',
            role: 'agent',
            content: 'new partial',
            thinking: null,
            tool_calls_json: null,
            decision_json: null,
            attachments_json: null,
            timestamp: '2026-06-02T00:00:01.000Z',
            status: 'running',
            process_item_count: 1,
          },
        ]
      }
      if (msg.type === 'sessions.messageProcess') {
        return new Promise((resolve) => { resolveProcess = resolve })
      }
      return []
    })
    useSessionStore.setState({
      runningSessionIds: { 'sess-refresh': true },
      streamingMessage: {
        id: 'msg-agent-running-visible',
        role: 'agent',
        content: 'old partial',
        thinking: '',
        toolCalls: [],
        processBlocks: [{ id: 'tpi-note-old', kind: 'note', text: 'old process' }],
        finalAnswer: 'old partial',
        done: false,
      },
    })

    await useSessionStore.getState().fetchMessages('sess-refresh')

    expect(useSessionStore.getState().streamingMessage?.id).toBe('msg-agent-running-visible')
    expect(useSessionStore.getState().streamingMessage?.finalAnswer).toBe('old partial')
    resolveProcess([])
  })

  test('reloads process blocks when cached blocks are fewer than the server count', async () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'sessions.messageProcess') {
        return [
          {
            id: 'tpi-note-1',
            session_id: 'sess-refresh',
            message_id: 'msg-agent-running',
            sequence: 1,
            kind: 'note',
            status: 'completed',
            title: 'note',
            summary: 'one',
            preview: 'one',
            content: 'one',
            meta_json: null,
            created_at: '2026-06-02T00:00:01.000Z',
            updated_at: '2026-06-02T00:00:01.000Z',
            has_detail: false,
          },
          {
            id: 'tpi-tool-1',
            session_id: 'sess-refresh',
            message_id: 'msg-agent-running',
            sequence: 2,
            kind: 'tool',
            status: 'completed',
            title: 'filesystem.read_text_file src/app.ts',
            summary: 'two',
            preview: 'two',
            content: null,
            meta_json: null,
            created_at: '2026-06-02T00:00:02.000Z',
            updated_at: '2026-06-02T00:00:02.000Z',
            has_detail: false,
          },
          {
            id: 'tpi-thinking-1',
            session_id: 'sess-refresh',
            message_id: 'msg-agent-running',
            sequence: 3,
            kind: 'thinking',
            status: 'running',
            title: 'thinking',
            summary: 'three',
            preview: 'three',
            content: 'three',
            meta_json: null,
            created_at: '2026-06-02T00:00:03.000Z',
            updated_at: '2026-06-02T00:00:03.000Z',
            has_detail: false,
          },
        ]
      }
      return []
    })
    useSessionStore.setState({
      messages: [
        {
          id: 'msg-agent-running',
          session_id: 'sess-refresh',
          role: 'agent',
          content: 'partial answer',
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: null,
          timestamp: '2026-06-02T00:00:01.000Z',
          status: 'running',
          process_item_count: 3,
          processBlocks: [{ id: 'tpi-note-1', kind: 'note', text: 'one' }],
          finalAnswer: 'partial answer',
        },
      ],
    })

    await useSessionStore.getState().fetchMessageProcess('sess-refresh', 'msg-agent-running')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'sessions.messageProcess', sessionId: 'sess-refresh', messageId: 'msg-agent-running' })
    expect(useSessionStore.getState().messages[0].processBlocks).toHaveLength(3)
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

describe('session selection storage', () => {
  test('persists and reads selected session id', () => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.request.mockResolvedValue([])
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { storage.set(key, value) }),
      removeItem: vi.fn((key: string) => { storage.delete(key) }),
      clear: vi.fn(() => { storage.clear() }),
      key: vi.fn(() => null),
      get length() { return storage.size },
    } as unknown as Storage)

    try {
      useSessionStore.getState().selectSession('sess-persisted')
      expect(storage.get('ai-ide-current-session-id')).toBe('sess-persisted')
      expect(readStoredSessionId()).toBe('sess-persisted')
      useSessionStore.getState().selectSession(null)
      expect(readStoredSessionId()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
