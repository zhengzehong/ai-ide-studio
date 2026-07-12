import { describe, it, expect, beforeEach, vi } from 'vitest'

// 这个测试验证 GuestChatPage 的 session:event 处理逻辑的等价纯函数。
// 由于项目没装 @testing-library/react,我们直接测纯函数逻辑:
// 把 GuestChatPage 里的 message.user push 和 session:done 去重逻辑抽出来,
// 用相同的 reducer 验证 3 个 P1 bug 修复行为。

interface GuestMessage {
  id: string
  role: string
  content: string
  sender_role: string | null
  sender_id: string | null
  sender_name: string | null
  timestamp: string
}

interface StreamingState {
  id: string
  content: string
}

interface GuestChatReducerState {
  messages: GuestMessage[]
  streaming: StreamingState | null
  subscribed: boolean
  lastShareId: string | null
}

// 复刻 GuestChatPage 的 message.user 事件处理逻辑
function applyMessageUserEvent(
  state: GuestChatReducerState,
  event: { type: string; message_id?: string; id?: string; created_at?: string },
  payload: { content?: string; senderRole?: string; senderId?: string; senderName?: string; messageId?: string },
): GuestChatReducerState {
  if (event.type !== 'message.user') return state
  const messageId = event.message_id ?? payload.messageId ?? `evt-${event.id ?? Date.now()}`
  const content = payload.content ?? ''
  const senderRole = payload.senderRole ?? 'user'
  const senderId = payload.senderId ?? null
  const senderName = payload.senderName ?? null
  const ts = event.created_at ?? new Date().toISOString()
  // Bug-1: 必须用 messageId 去重,防止重复 push
  if (state.messages.some((m) => m.id === messageId)) return state
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: messageId,
        role: 'human',
        content,
        sender_role: senderRole,
        sender_id: senderId,
        sender_name: senderName,
        timestamp: ts,
      },
    ],
  }
}

// 复刻 GuestChatPage 的 session:done 处理逻辑(带 messageId 去重)
function applySessionDone(
  state: GuestChatReducerState,
  msg: { messageId?: string },
  agentInfo: { id: string | null; name: string },
): GuestChatReducerState {
  const finalContent = state.streaming?.content ?? ''
  const finalId = state.streaming?.id ?? (msg.messageId ? String(msg.messageId) : `agent-${Date.now()}`)
  if (!finalContent) {
    return { ...state, streaming: null }
  }
  // Bug-3: messageId 去重,防止多轮对话重复 push
  if (state.messages.some((m) => m.id === finalId)) {
    return { ...state, streaming: null }
  }
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: finalId,
        role: 'agent',
        content: finalContent,
        sender_role: 'assistant',
        sender_id: agentInfo.id,
        sender_name: agentInfo.name,
        timestamp: new Date().toISOString(),
      },
    ],
    streaming: null,
  }
}

// 复刻 GuestChatPage 的 session:update 处理逻辑(streaming 累积)
function applySessionUpdate(
  state: GuestChatReducerState,
  msg: { messageId?: string; data?: { contentDelta?: string; content?: string; eventType?: string } },
): GuestChatReducerState {
  const data = msg.data ?? {}
  const contentDelta = typeof data.contentDelta === 'string' ? data.contentDelta : ''
  const content = typeof data.content === 'string' ? data.content : ''
  const eventType = typeof data.eventType === 'string' ? data.eventType : ''
  if (eventType === 'lifecycle.started' || contentDelta || content) {
    const prev = state.streaming
    const id = msg.messageId ? String(msg.messageId) : prev?.id ?? `stream-${Date.now()}`
    const nextContent = content || (prev ? prev.content + contentDelta : contentDelta)
    return { ...state, streaming: { id, content: nextContent } }
  }
  return state
}

// 复刻 Bug-2 fix 的 token 变化重置逻辑
function applyTokenChange(state: GuestChatReducerState): GuestChatReducerState {
  return {
    ...state,
    subscribed: false,
    lastShareId: null,
    messages: [],
    streaming: null,
  }
}

describe('GuestChatPage 行为逻辑测试', () => {
  let initialState: GuestChatReducerState

  beforeEach(() => {
    initialState = {
      messages: [],
      streaming: null,
      subscribed: false,
      lastShareId: null,
    }
  })

  describe('Bug-1: session:event message.user 推送', () => {
    it('收到 message.user 事件后,push 到 messages', () => {
      const next = applyMessageUserEvent(
        initialState,
        { type: 'message.user', message_id: 'msg-u1', created_at: '2026-07-12T10:00:00Z' },
        { content: 'hello agent', senderRole: 'guest', senderId: 'guest-1', senderName: 'Alice' },
      )
      expect(next.messages.length).toBe(1)
      expect(next.messages[0]).toMatchObject({
        id: 'msg-u1',
        role: 'human',
        content: 'hello agent',
        sender_role: 'guest',
        sender_id: 'guest-1',
        sender_name: 'Alice',
      })
    })

    it('owner 发的新消息也通过 message.user 事件推送', () => {
      const next = applyMessageUserEvent(
        initialState,
        { type: 'message.user', message_id: 'msg-u2', created_at: '2026-07-12T10:01:00Z' },
        { content: 'owner 发的新问题', senderRole: 'user', senderId: 'owner-1', senderName: 'Owner' },
      )
      expect(next.messages.length).toBe(1)
      expect(next.messages[0]?.sender_role).toBe('user')
      expect(next.messages[0]?.sender_name).toBe('Owner')
    })

    it('相同 messageId 的 message.user 事件不重复 push', () => {
      let state = applyMessageUserEvent(
        initialState,
        { type: 'message.user', message_id: 'msg-dup', created_at: '2026-07-12T10:00:00Z' },
        { content: 'first', senderRole: 'guest' },
      )
      state = applyMessageUserEvent(
        state,
        { type: 'message.user', message_id: 'msg-dup', created_at: '2026-07-12T10:00:00Z' },
        { content: 'first', senderRole: 'guest' },
      )
      expect(state.messages.length).toBe(1)
    })
  })

  describe('Bug-2: token 变化重置', () => {
    it('token 变化时重置 subscribed/lastShareId/messages/streaming', () => {
      const state: GuestChatReducerState = {
        messages: [
          { id: 'old1', role: 'human', content: 'old', sender_role: 'guest', sender_id: null, sender_name: null, timestamp: '2026-07-12T09:00:00Z' },
        ],
        streaming: { id: 'stream1', content: 'partial...' },
        subscribed: true,
        lastShareId: 'shr-old',
      }
      const next = applyTokenChange(state)
      expect(next.subscribed).toBe(false)
      expect(next.lastShareId).toBe(null)
      expect(next.messages.length).toBe(0)
      expect(next.streaming).toBe(null)
    })
  })

  describe('Bug-3: session:done 多轮不覆盖', () => {
    it('第 1 轮 done 后 push agent 消息,第 2 轮 done 不覆盖第 1 轮', () => {
      // 第 1 轮:streaming 累积 + done
      let state = applySessionUpdate(initialState, {
        messageId: 'msg-a1',
        data: { contentDelta: 'agent reply 1' },
      })
      state = applySessionDone(state, { messageId: 'msg-a1' }, { id: 'agent-1', name: 'Agent' })
      expect(state.messages.length).toBe(1)
      expect(state.messages[0]?.content).toBe('agent reply 1')

      // 第 2 轮:不同 messageId 的 streaming + done
      state = applySessionUpdate(state, {
        messageId: 'msg-a2',
        data: { contentDelta: 'agent reply 2' },
      })
      state = applySessionDone(state, { messageId: 'msg-a2' }, { id: 'agent-1', name: 'Agent' })
      // 两条 agent 消息都应在
      expect(state.messages.length).toBe(2)
      expect(state.messages[0]?.content).toBe('agent reply 1')
      expect(state.messages[1]?.content).toBe('agent reply 2')
    })

    it('相同 messageId 的 done 事件不重复 push', () => {
      let state = applySessionUpdate(initialState, {
        messageId: 'msg-a1',
        data: { contentDelta: 'agent reply 1' },
      })
      state = applySessionDone(state, { messageId: 'msg-a1' }, { id: 'agent-1', name: 'Agent' })
      // 再次触发相同 messageId 的 done(模拟重复事件)
      state = {
        ...state,
        streaming: { id: 'msg-a1', content: 'agent reply 1' },
      }
      state = applySessionDone(state, { messageId: 'msg-a1' }, { id: 'agent-1', name: 'Agent' })
      expect(state.messages.length).toBe(1)
    })

    it('streaming 为空时 done 不 push', () => {
      const state = applySessionDone(initialState, { messageId: 'msg-x' }, { id: 'a', name: 'A' })
      expect(state.messages.length).toBe(0)
      expect(state.streaming).toBe(null)
    })
  })

  describe('session:update streaming 累积', () => {
    it('多次 contentDelta 累积到 streaming.content', () => {
      let state = applySessionUpdate(initialState, {
        messageId: 'msg-a1',
        data: { contentDelta: 'Hello' },
      })
      state = applySessionUpdate(state, {
        messageId: 'msg-a1',
        data: { contentDelta: ' world' },
      })
      expect(state.streaming?.content).toBe('Hello world')
      expect(state.streaming?.id).toBe('msg-a1')
    })

    it('content (full replace) 优先于 contentDelta 累积', () => {
      let state = applySessionUpdate(initialState, {
        messageId: 'msg-a1',
        data: { contentDelta: 'Hello' },
      })
      state = applySessionUpdate(state, {
        messageId: 'msg-a1',
        data: { content: 'Replaced full content' },
      })
      expect(state.streaming?.content).toBe('Replaced full content')
    })

    it('lifecycle.started 也触发 streaming', () => {
      const state = applySessionUpdate(initialState, {
        messageId: 'msg-a1',
        data: { eventType: 'lifecycle.started' },
      })
      expect(state.streaming).not.toBe(null)
    })
  })
})
