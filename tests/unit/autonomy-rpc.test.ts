import { describe, expect, test, vi } from 'vitest'
import { autonomyRpcHandlers } from '../../src/gateway/rpc/autonomy.js'

describe('autonomy RPC authorization', () => {
  test('rejects shared-session guests before reading project autonomy state', () => {
    const handler = autonomyRpcHandlers['autonomy.list']
    expect(() => handler({ type: 'autonomy.list', projectId: 'project-a' }, {
      state: { subscriptions: new Set(), authMode: 'guest', shareToken: 'share-token' },
      sendResult: vi.fn(),
      sendError: vi.fn(),
      sendOutOfBandError: vi.fn(),
    })).toThrow('访客无权访问自主 Agent')
  })
})
