import { describe, expect, test } from 'vitest'
import { reduceSessionEvents } from '../../ui/src/stores/session-events.ts'

function ev(sequence: number, type: string, payload: unknown) {
  return {
    id: `evt-life-${sequence}`,
    session_id: 'sess-life',
    agent_id: 'agent-life',
    acp_session_id: null,
    message_id: null,
    type,
    role: null,
    payload_json: JSON.stringify(payload),
    sequence,
    created_at: new Date(sequence * 1000).toISOString(),
  }
}

describe('ACP lifecycle event reducer', () => {
  test('从 lifecycle 事件恢复 pending 阶段，并在真实输出到达后清理阶段文案', () => {
    const pending = reduceSessionEvents([
      ev(1, 'lifecycle.runtime_starting', { messageId: 'life-1', role: 'system', content: '正在启动 Agent...' }),
    ])
    expect(pending.streamingMessage?.stage).toBe('正在启动 Agent...')

    const streaming = reduceSessionEvents([
      ev(1, 'lifecycle.runtime_starting', { messageId: 'msg-1', role: 'system', content: '正在启动 Agent...' }),
      ev(2, 'message.chunk', { messageId: 'msg-1', role: 'agent', contentDelta: '你好' }),
    ])
    expect(streaming.streamingMessage?.content).toBe('你好')
    expect(streaming.streamingMessage?.stage).toBeUndefined()
  })
})
