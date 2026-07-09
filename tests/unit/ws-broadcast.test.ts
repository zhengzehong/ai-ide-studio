import { describe, expect, test, vi, afterEach } from 'vitest'
import { broadcastToSubscribers } from '../../src/gateway/ws-handler.js'

describe('broadcastToSubscribers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('skips session update serialization when no client subscribed', () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify')

    broadcastToSubscribers('sess-none', {
      type: 'session:update',
      sessionId: 'sess-none',
      agentId: 'agent-test',
      data: {
        messageId: 'msg-1',
        role: 'agent',
        contentDelta: 'stream chunk',
      },
    })

    expect(stringifySpy).not.toHaveBeenCalled()
  })
})
