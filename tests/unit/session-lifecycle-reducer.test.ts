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

  test('断开类 lifecycle 事件不会恢复成可见 streaming 气泡', () => {
    const reduced = reduceSessionEvents([
      ev(1, 'lifecycle.session_disconnected', { messageId: 'life-disconnect', role: 'system', content: '会话已断开' }),
    ])

    expect(reduced.streamingMessage).toBeNull()
  })

  test('断开类 lifecycle 事件会清理只有阶段文案的 streaming 气泡', () => {
    const reduced = reduceSessionEvents([
      ev(1, 'lifecycle.runtime_starting', { messageId: 'life-start', role: 'system', content: '正在启动 Agent...' }),
      ev(2, 'lifecycle.runtime_stopped', { messageId: 'life-stop', role: 'system', content: '运行时已停止' }),
    ])

    expect(reduced.streamingMessage).toBeNull()
  })


  test('startup interrupted lifecycle does not restore a visible streaming bubble', () => {
    const reduced = reduceSessionEvents([
      ev(1, 'lifecycle.interrupted', { messageId: 'life-interrupted', role: 'system', content: '\u751f\u6210\u5df2\u4e2d\u65ad\uff0c\u53ef\u91cd\u65b0\u53d1\u9001' }),
      ev(2, 'message.done', { messageId: 'life-interrupted', stopReason: 'error', error: '\u670d\u52a1\u91cd\u542f\uff0c\u751f\u6210\u5df2\u4e2d\u65ad' }),
    ])

    expect(reduced.streamingMessage).toBeNull()
  })
})
