import { describe, expect, test } from 'vitest'
import { buildChatTimelineFromEvents, type SessionEventData } from '../../ui/src/stores/session-events.ts'

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

describe('buildChatTimelineFromEvents', () => {
  test('keeps assistant text and tool calls in event order', () => {
    const items = buildChatTimelineFromEvents([
      ev(1, 'message.user', { messageId: 'msg-user-1', content: '请分析这个问题', attachments: [] }, 'msg-user-1'),
      ev(2, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: '先读代码。' }),
      ev(3, 'tool.call', {
        messageId: 'msg-agent-1',
        toolCall: { id: 'tool-1', title: '读取文件', status: 'in_progress' },
      }),
      ev(4, 'tool.update', {
        messageId: 'msg-agent-1',
        toolCall: { id: 'tool-1', status: 'completed', terminalOutputDelta: 'ok\n' },
      }),
      ev(5, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: '然后给结论。' }),
      ev(6, 'message.done', {
        messageId: 'msg-agent-1',
        turnUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      }),
    ])

    expect(items.map((item) => item.kind)).toEqual(['message', 'message', 'tool', 'message'])
    expect(items[0]).toMatchObject({ role: 'human', content: '请分析这个问题' })
    expect(items[1]).toMatchObject({ role: 'agent', content: '先读代码。' })
    expect(items[2]).toMatchObject({ kind: 'tool', toolCall: { id: 'tool-1', status: 'completed' } })
    expect(items[2].kind === 'tool' ? items[2].toolCall.terminalOutput : '').toBe('ok\n')
    expect(items[3]).toMatchObject({ role: 'agent', content: '然后给结论。' })
    expect(items[3].kind === 'message' ? items[3].turnStats?.totalTokens : undefined).toBe(30)
  })

  test('flushes thinking before the following tool call', () => {
    const items = buildChatTimelineFromEvents([
      ev(1, 'thinking.chunk', { messageId: 'msg-agent-1', thinking: '我需要先检查配置。' }),
      ev(2, 'tool.call', {
        messageId: 'msg-agent-1',
        toolCall: { id: 'tool-1', title: '检查配置', status: 'in_progress' },
      }),
    ])

    expect(items.map((item) => item.kind)).toEqual(['message', 'tool'])
    expect(items[0]).toMatchObject({ role: 'agent', thinking: '我需要先检查配置。' })
  })
})
