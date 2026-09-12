import { describe, expect, it } from 'vitest'
import { RealtimeHub, type RealtimeHubOptions } from '../../src/realtime/hub.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

function fixture(): {
  hub: RealtimeHub
  frames: ServerMessage[]
  requests: Parameters<NonNullable<RealtimeHubOptions['onLegacyRpc']>>[0][]
  query: () => string
  subscribe: (id: string) => void
  unsubscribe: (id: string) => void
  receives: (id: string) => boolean
} {
  const frames: ServerMessage[] = []
  const requests: Parameters<NonNullable<RealtimeHubOptions['onLegacyRpc']>>[0][] = []
  const hub = new RealtimeHub({ maxQueueMessages: 500, maxQueueBytes: 2e6, maxBufferedBytes: 2e6, flushIntervalMs: 1, onLegacyRpc: request => requests.push(request) })
  hub.addConnection('owner', { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (payload, callback): void => { frames.push(JSON.parse(payload) as ServerMessage); callback?.() }, close: (): void => {} }, { authMode: 'owner' })
  return {
    hub, frames, requests,
    query: (): string => { hub.handleClientMessage('owner', { type: 'session.getModels', sessionId: 'master' }); return requests.at(-1)!.bridgeRequestId },
    subscribe: (id): void => hub.handleClientMessage('owner', { type: 'subscribe', sessionIds: [id] }),
    unsubscribe: (id): void => hub.handleClientMessage('owner', { type: 'unsubscribe', sessionIds: [id] }),
    receives: (id): boolean => {
      frames.length = 0
      hub.deliver({ scope: 'session', sessionId: id, message: { type: 'session:done', sessionId: id, agentId: 'agent', messageId: 'reply' } })
      return frames.some(frame => frame.type === 'session:done')
    },
  }
}

describe('in-flight RPC subscription reconciliation', () => {
  it('does not remove a Master subscription added after a readonly query started', () => {
    const f = fixture()
    const request = f.query()
    f.subscribe('master')
    expect(f.receives('master')).toBe(true)
    f.hub.applyLegacySubscriptions('owner', [], request)
    expect(f.receives('master')).toBe(true)
    f.hub.close()
  })

  it('does not resurrect subscriptions removed while a readonly query was pending', () => {
    const f = fixture()
    f.subscribe('master')
    const request = f.query()
    f.unsubscribe('master')
    f.hub.applyLegacySubscriptions('owner', ['master'], request)
    expect(f.receives('master')).toBe(false)
    f.hub.close()
  })

  it('applies actual RPC additions/removals without overwriting unrelated subscriptions', () => {
    const f = fixture()
    f.subscribe('closed')
    const request = f.query()
    f.subscribe('master')
    f.hub.applyLegacySubscriptions('owner', ['created'], request)
    expect(f.receives('closed')).toBe(false)
    expect(f.receives('created')).toBe(true)
    expect(f.receives('master')).toBe(true)
    f.hub.close()
  })

  it('respects an explicit cancellation even before a delayed creation subscribes', () => {
    const f = fixture()
    const request = f.query()
    f.unsubscribe('created')
    f.hub.applyLegacySubscriptions('owner', ['created'], request)
    expect(f.receives('created')).toBe(false)
    f.hub.close()
  })

  it('respects reselecting a session while an older RPC removes it', () => {
    const f = fixture()
    f.subscribe('master')
    const request = f.query()
    f.unsubscribe('master')
    f.subscribe('master')
    f.hub.applyLegacySubscriptions('owner', [], request)
    expect(f.receives('master')).toBe(true)
    f.hub.close()
  })

  it('ignores duplicate completion after a later unsubscribe', () => {
    const f = fixture()
    const request = f.query()
    f.hub.applyLegacySubscriptions('owner', ['created'], request)
    f.unsubscribe('created')
    f.hub.applyLegacySubscriptions('owner', ['created'], request)
    expect(f.receives('created')).toBe(false)
    f.hub.close()
  })
})
