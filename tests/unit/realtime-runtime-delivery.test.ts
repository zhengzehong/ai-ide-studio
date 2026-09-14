import { describe, expect, test } from 'vitest'
import { runtimeMessageDelivery } from '../../src/realtime/service.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

describe('runtimeMessageDelivery(runtime 流投递作用域)', () => {
  test('session:activity 走 all-scope:非订阅客户端也要复位侧栏"正在执行"、打未读', () => {
    const message = {
      type: 'session:activity',
      sessionId: 'sess-a',
      agentId: 'agent-a',
      state: 'idle',
      reason: 'autonomous-done',
      timestamp: '2026-09-14T08:00:00.000Z',
    } as unknown as ServerMessage

    expect(runtimeMessageDelivery(message)).toEqual({ scope: 'all', message })
  })

  test('带 sessionId 的 session:update 仍按订阅投递', () => {
    const message = {
      type: 'session:update',
      sessionId: 'sess-a',
      agentId: 'agent-a',
      data: { messageId: 'auto-1', role: 'agent', contentDelta: 'x' },
    } as unknown as ServerMessage

    expect(runtimeMessageDelivery(message)).toEqual({ scope: 'session', sessionId: 'sess-a', message })
  })

  test('无 sessionId 的消息全局广播', () => {
    const message = { type: 'agent:status', agentId: 'agent-a', status: 'running' } as unknown as ServerMessage

    expect(runtimeMessageDelivery(message)).toEqual({ scope: 'all', message })
  })
})