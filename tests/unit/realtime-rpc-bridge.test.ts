import { describe, expect, it, vi } from 'vitest'
import { createRealtimeRpcBridge } from '../../src/gateway/realtime-rpc-bridge.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

describe('Realtime RPC bridge', () => {
  it('emits result/error frames and returns subscriptions mutated by API handlers', async () => {
    const dispatch = vi.fn(async (_message: unknown, context: RpcContext) => {
      context.state.subscriptions.add('session-created')
      context.sendResult({ id: 'session-created' })
      context.sendOutOfBandError('later failure')
    })
    const bridge = createRealtimeRpcBridge(dispatch)
    const frames: ServerMessage[] = []

    const subscriptions = await bridge({
      connectionId: 'connection-a',
      message: { type: 'sessions.create', requestId: 'request-a', agentId: 'agent-a' },
      state: { authMode: 'owner', subscriptions: ['session-a'] },
      emit: (frame) => frames.push(frame),
    })

    expect(subscriptions).toEqual(['session-a', 'session-created'])
    expect(frames).toEqual([
      { type: 'result', requestId: 'request-a', data: { id: 'session-created' } },
      { type: 'error', message: 'later failure' },
    ])
  })
})
