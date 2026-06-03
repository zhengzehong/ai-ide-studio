import { describe, test, expect } from 'vitest'
import { buildCompletedAgentMessage, type SessionEventData } from '../../ui/src/stores/session-events.ts'

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

describe('buildCompletedAgentMessage', () => {
  test('从持久化事件重建完整的 Agent 消息', () => {
    const msg = buildCompletedAgentMessage('sess-1', [
      ev(1, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: '第一段' }),
      ev(2, 'thinking.chunk', { messageId: 'msg-agent-1', thinking: '思考中' }),
      ev(3, 'tool.call', { messageId: 'msg-agent-1', toolCall: { id: 'tool-1', title: '运行命令', kind: 'execute', status: 'in_progress', rawInput: { command: 'npm run build' } } }),
      ev(4, 'tool.update', { messageId: 'msg-agent-1', toolCall: { id: 'tool-1', status: 'completed', terminalOutputDelta: 'ok\n' } }),
      ev(5, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: '第二段' }),
      ev(6, 'message.done', { messageId: 'done-sess-1' }, 'done-sess-1'),
    ], { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, 0.01, 2)

    expect(msg).toBeTruthy()
    expect(msg?.id).toBe('msg-agent-1')
    expect(msg?.role).toBe('agent')
    expect(msg?.content).toBe('第二段')
    expect(msg?.thinking).toBe('思考中')
    expect(JSON.parse(msg?.tool_calls_json || '[]')[0].terminalOutput).toBe('ok\n')
    expect(JSON.parse(msg?.decision_json || '{}').totalTokens).toBe(3)
    expect(JSON.parse(msg?.decision_json || '{}').elapsedSeconds).toBe(2)
  })

  test('没有 message.done 事件也能重建中断的消息', () => {
    const msg = buildCompletedAgentMessage('sess-1', [
      ev(1, 'message.chunk', { messageId: 'msg-agent-3', role: 'agent', contentDelta: '中断回复' }, 'msg-agent-3'),
    ])
    expect(msg).toBeTruthy()
    expect(msg?.content).toBe('中断回复')
  })

  test('done 事件和 chunk 使用相同 messageId 也能正常重建', () => {
    const msg = buildCompletedAgentMessage('sess-1', [
      ev(1, 'message.chunk', { messageId: 'msg-agent-2', role: 'agent', contentDelta: '回复' }, 'msg-agent-2'),
      ev(2, 'message.done', { messageId: 'msg-agent-2' }, 'msg-agent-2'),
    ])
    expect(msg).toBeTruthy()
    expect(msg?.content).toBe('回复')
  })

  test('ACP 重复使用同一个 messageId 时只重建最新一轮回复', () => {
    const msg = buildCompletedAgentMessage('sess-1', [
      ev(1, 'message.chunk', { messageId: 'msg-reused', role: 'agent', contentDelta: '旧回复' }, 'msg-reused'),
      ev(2, 'message.done', { messageId: 'done-sess-1' }, 'done-sess-1'),
      ev(3, 'message.chunk', { messageId: 'msg-reused', role: 'agent', contentDelta: '新回复' }, 'msg-reused'),
      ev(4, 'message.done', { messageId: 'done-sess-1' }, 'done-sess-1'),
    ])

    expect(msg).toBeTruthy()
    expect(msg?.id).toBe('msg-reused')
    expect(msg?.content).toBe('新回复')
  })
})
