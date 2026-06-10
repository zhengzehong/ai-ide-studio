import { describe, expect, test } from 'vitest'
import { buildChatRenderItems, type ChatRenderMessage } from '../../ui/src/components/chat/render-items.ts'
import type { SessionEventData } from '../../ui/src/stores/session-events.ts'

function ev(sequence: number, type: string, payload: unknown, messageId = 'msg-agent-1'): SessionEventData {
  return {
    id: `evt-${sequence}`,
    session_id: 'sess-1',
    agent_id: 'agent-1',
    acp_session_id: null,
    message_id: messageId,
    type,
    role: null,
    payload_json: JSON.stringify(payload),
    sequence,
    created_at: new Date(sequence * 1000).toISOString(),
  }
}

function msg(id: string, role: 'agent' | 'human', content: string): ChatRenderMessage {
  return {
    id,
    session_id: 'sess-1',
    role,
    content,
    thinking: null,
    tool_calls_json: null,
    decision_json: null,
    timestamp: new Date(10_000).toISOString(),
  }
}

describe('buildChatRenderItems', () => {
  test('uses event timeline groups only when no persisted messages are loaded', () => {
    const items = buildChatRenderItems({
      messages: [],
      events: [
        ev(1, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: 'first text' }),
        ev(2, 'tool.call', {
          messageId: 'msg-agent-1',
          toolCall: { id: 'tool-1', title: 'read files', status: 'completed' },
        }),
        ev(3, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: 'second text' }),
        ev(4, 'tool.call', {
          messageId: 'msg-agent-1',
          toolCall: { id: 'tool-2', title: 'list files', status: 'completed' },
        }),
        ev(5, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: 'final text' }),
      ],
      streamingBubble: null,
      showStreamingBubble: false,
      blockingInteraction: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('group')
    if (items[0].kind !== 'group') throw new Error('expected timeline group')
    expect(items[0].group.blocks.map((block) => block.kind)).toEqual(['message', 'tool', 'message', 'tool', 'message'])
  })

  test('prefers persisted messages over historical event timeline groups', () => {
    const persisted = msg('msg-agent-1', 'agent', 'persisted final answer')
    const items = buildChatRenderItems({
      messages: [persisted],
      events: [
        ev(1, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: 'event final answer' }),
        ev(2, 'message.done', { messageId: 'msg-agent-1' }),
      ],
      streamingBubble: null,
      showStreamingBubble: false,
      blockingInteraction: false,
    })

    expect(items).toEqual([{ id: 'msg:msg-agent-1', kind: 'message', message: persisted }])
  })

  test('falls back to messages when no timeline events are available', () => {
    const items = buildChatRenderItems({
      messages: [msg('msg-agent-1', 'agent', 'legacy message')],
      events: [],
      streamingBubble: null,
      showStreamingBubble: false,
      blockingInteraction: false,
    })

    expect(items).toEqual([{ id: 'msg:msg-agent-1', kind: 'message', message: msg('msg-agent-1', 'agent', 'legacy message') }])
  })

  test('keeps persisted messages when event history is present', () => {
    const oldMessage = { ...msg('msg-old', 'agent', 'older history'), timestamp: new Date(1_000).toISOString() }
    const items = buildChatRenderItems({
      messages: [oldMessage, msg('msg-agent-1', 'agent', 'newer event-backed history')],
      events: [ev(2, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: 'newer event-backed history' })],
      streamingBubble: null,
      showStreamingBubble: false,
      blockingInteraction: false,
      timelineEventLimit: 1,
    })

    expect(items.map((item) => item.kind)).toEqual(['message', 'message'])
    expect(items[0]).toEqual({ id: 'msg:msg-old', kind: 'message', message: oldMessage })
  })

  test('keeps a streaming bubble when existing timeline events do not cover the streaming reply', () => {
    const streaming = { ...msg('pending-reply', 'agent', ''), streaming: true, stage: '正在准备 Agent...' }
    const items = buildChatRenderItems({
      messages: [],
      events: [ev(1, 'message.user', { messageId: 'msg-user-1', content: 'hello' }, 'msg-user-1')],
      streamingBubble: streaming,
      showStreamingBubble: true,
      blockingInteraction: false,
    })

    expect(items.map((item) => item.kind)).toEqual(['group', 'streaming'])
    expect(items[1]).toEqual({ id: 'streaming:pending-reply', kind: 'streaming', message: streaming })
  })

  test('keeps a streaming bubble even when its id appears in historical events', () => {
    const streaming = { ...msg('msg-agent-1', 'agent', 'live delta'), streaming: true }
    const items = buildChatRenderItems({
      messages: [],
      events: [
        ev(1, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: 'old text' }),
        ev(2, 'message.done', { messageId: 'msg-agent-1' }),
      ],
      streamingBubble: streaming,
      showStreamingBubble: true,
      blockingInteraction: false,
    })

    expect(items.at(-1)).toEqual({ id: 'streaming:msg-agent-1', kind: 'streaming', message: streaming })
  })

  test('uses the streaming bubble instead of a persisted message with the same id', () => {
    const persisted = msg('msg-agent-live', 'agent', 'partial persisted text')
    const streaming = { ...msg('msg-agent-live', 'agent', 'live text'), streaming: true }
    const items = buildChatRenderItems({
      sessionId: 'sess-1',
      messages: [msg('msg-human-1', 'human', 'hello'), persisted],
      events: [],
      streamingBubble: streaming,
      showStreamingBubble: true,
      blockingInteraction: false,
    })

    expect(items.map((item) => item.id)).toEqual(['msg:msg-human-1', 'streaming:msg-agent-live'])
    expect(items.at(-1)).toEqual({ id: 'streaming:msg-agent-live', kind: 'streaming', message: streaming })
  })

  test('keeps persisted and streaming messages separate when their ids differ', () => {
    const persisted = msg('msg-agent-done', 'agent', 'done')
    const streaming = { ...msg('msg-agent-live', 'agent', 'live text'), streaming: true }
    const items = buildChatRenderItems({
      sessionId: 'sess-1',
      messages: [persisted],
      events: [],
      streamingBubble: streaming,
      showStreamingBubble: true,
      blockingInteraction: false,
    })

    expect(items.map((item) => item.id)).toEqual(['msg:msg-agent-done', 'streaming:msg-agent-live'])
  })


  test('keeps finalized messages that are not represented by timeline events', () => {
    const finalReply = msg('msg-agent-final', 'agent', 'final answer')
    const items = buildChatRenderItems({
      messages: [finalReply],
      events: [ev(1, 'message.user', { messageId: 'msg-user-1', content: 'hello' }, 'msg-user-1')],
      streamingBubble: null,
      showStreamingBubble: false,
      blockingInteraction: false,
    })

    expect(items).toEqual([{ id: 'msg:msg-agent-final', kind: 'message', message: finalReply }])
  })

  test('filters messages and timeline events to the selected session', () => {
    const current = { ...msg('msg-current', 'human', 'current session'), session_id: 'sess-current' }
    const stale = { ...msg('msg-stale', 'agent', 'stale session'), session_id: 'sess-stale' }
    const staleEvent = {
      ...ev(1, 'message.chunk', { messageId: 'msg-stale', role: 'agent', contentDelta: 'stale session' }, 'msg-stale'),
      session_id: 'sess-stale',
    }

    const items = buildChatRenderItems({
      sessionId: 'sess-current',
      messages: [current, stale],
      events: [staleEvent],
      streamingBubble: null,
      showStreamingBubble: false,
      blockingInteraction: false,
    } as Parameters<typeof buildChatRenderItems>[0] & { sessionId: string })

    expect(items).toEqual([{ id: 'msg:msg-current', kind: 'message', message: current }])
  })

  test('reuses unchanged persisted message items across streaming-only updates', () => {
    const first = msg('msg-human-1', 'human', 'hello')
    const second = msg('msg-agent-1', 'agent', 'done')
    const initial = buildChatRenderItems({
      sessionId: 'sess-1',
      messages: [first, second],
      events: [],
      streamingBubble: null,
      showStreamingBubble: false,
      blockingInteraction: false,
    })

    const streaming = { ...msg('msg-agent-live', 'agent', 'live delta'), streaming: true }
    const next = buildChatRenderItems({
      sessionId: 'sess-1',
      messages: [first, second],
      events: [],
      streamingBubble: streaming,
      showStreamingBubble: true,
      blockingInteraction: false,
      previousItems: initial,
    })

    expect(next[0]).toBe(initial[0])
    expect(next[1]).toBe(initial[1])
    expect(next[2]).toEqual({ id: 'streaming:msg-agent-live', kind: 'streaming', message: streaming })
  })
})
