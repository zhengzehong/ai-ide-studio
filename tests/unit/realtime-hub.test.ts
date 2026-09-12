import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RealtimeHub,
  type RealtimeSocket,
} from '../../src/realtime/hub.js'
import type { RealtimeDelivery } from '../../src/realtime/protocol.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

afterEach(() => vi.restoreAllMocks())

describe('RealtimeHub', () => {
  it.each(['cursor-gap', 'buffered-socket'])('disconnects when %s cannot queue a recovery notification behind RPC results', (trigger) => {
    const hub = createHub(2)
    const socket = new FakeSocket()
    hub.addConnection('owner', socket, { authMode: 'owner' })
    hub.handleClientMessage('owner', { type: 'subscribe', sessionIds: ['session-a'] })
    hub.deliver(sessionDelivery(update('session-a', 1)))
    socket.autoComplete = false
    for (const requestId of ['r0', 'r1', 'r2']) {
      hub.applyLegacyFrame('owner', { type: 'result', requestId, data: [] })
    }
    expect(hub.queuedMessageCount).toBe(2)

    if (trigger === 'cursor-gap') hub.deliver(sessionDelivery(update('session-a', 3)))
    else {
      socket.bufferedAmount = 128 * 1024
      socket.completeNext()
    }

    expect(socket.closed?.code).toBe(1013)
    expect(hub.connectionCount).toBe(0)
    expect(hub.subscribedSessionCount).toBe(0)
    expect(hub.queuedMessageCount).toBe(0)
    socket.completeAll()
    hub.close()
  })

  it('can query history during resync and resume only after receiving it', () => {
    const hub = createHub()
    const socket = new FakeSocket()
    hub.addConnection('owner', socket, { authMode: 'owner' })
    hub.handleClientMessage('owner', { type: 'subscribe', sessionIds: ['session-a'] })
    hub.deliver(sessionDelivery(update('session-a', 1)))
    hub.deliver(sessionDelivery(update('session-a', 3)))
    socket.sent.length = 0
    hub.applyLegacyFrame('owner', { type: 'result', requestId: 'recovery', data: [] })
    expect(socket.messages()).toEqual([{ type: 'result', requestId: 'recovery', data: [] }])
    hub.handleClientMessage('owner', { type: 'resume', cursors: { 'session-a': { streamGeneration: 'generation-a', sequence: 3 } } })
    hub.deliver(sessionDelivery(update('session-a', 4)))
    expect(socket.messages().at(-1)).toMatchObject({ type: 'session:update', sequence: 4 })
    hub.close()
  })

  it('delivers session events only to subscribers and global events to all owners', () => {
    const hub = createHub()
    const first = new FakeSocket()
    const second = new FakeSocket()
    hub.addConnection('first', first, { authMode: 'owner' })
    hub.addConnection('second', second, { authMode: 'owner' })
    hub.handleClientMessage('first', { type: 'subscribe', sessionIds: ['session-a'] })

    first.sent.length = 0
    second.sent.length = 0
    hub.deliver(sessionDelivery(update('session-a', 1)))
    hub.deliver({ scope: 'all', message: { type: 'task:update', taskId: 'task-a', data: {} } })

    expect(first.messages().map((message) => message.type)).toEqual(['session:update', 'task:update'])
    expect(second.messages().map((message) => message.type)).toEqual(['task:update'])
  })

  it('restricts guest subscriptions and removes hidden tool call payloads', () => {
    const hub = createHub()
    const guest = new FakeSocket()
    hub.addConnection('guest', guest, {
      authMode: 'guest',
      sessionId: 'session-a',
      toolCallVisibility: 'hide',
    })

    hub.handleClientMessage('guest', { type: 'subscribe', sessionIds: ['session-b'] })
    expect(guest.messages().at(-1)).toMatchObject({ type: 'error' })

    hub.handleClientMessage('guest', { type: 'subscribe', sessionIds: ['session-a'] })
    guest.sent.length = 0
    hub.deliver(sessionDelivery({
      ...update('session-a', 1),
      data: {
        messageId: 'msg-1',
        role: 'agent',
        contentDelta: 'visible',
        toolCall: { id: 'tool-a', title: 'secret' },
      },
    }))

    const delivered = guest.messages()[0] as Extract<ServerMessage, { type: 'session:update' }>
    expect(delivered.data.contentDelta).toBe('visible')
    expect(delivered.data.toolCall).toBeUndefined()
  })

  it('does not serialize an unsubscribed session delivery', () => {
    const stringify = vi.spyOn(JSON, 'stringify')
    const hub = createHub()
    hub.addConnection('owner', new FakeSocket(), { authMode: 'owner' })

    hub.deliver(sessionDelivery(update('session-a', 1)))

    expect(stringify).not.toHaveBeenCalled()
  })

  it('handles ping, resume acknowledgement, generation changes, and sequence gaps', () => {
    const hub = createHub()
    const socket = new FakeSocket()
    hub.addConnection('owner', socket, { authMode: 'owner' })
    hub.handleClientMessage('owner', { type: 'subscribe', sessionIds: ['session-a'] })
    socket.sent.length = 0

    hub.handleClientMessage('owner', { type: 'ping', timestamp: 123 })
    hub.handleClientMessage('owner', { type: 'resume', cursors: {} })
    hub.deliver(sessionDelivery(update('session-a', 1)))
    hub.deliver(sessionDelivery(update('session-a', 3)))
    hub.deliver(sessionDelivery({ ...update('session-a', 1), streamGeneration: 'generation-b' }))

    expect(socket.messages().map((message) => message.type)).toEqual([
      'pong',
      'resume:ack',
      'session:update',
      'resync_required',
    ])
  })

  it('loads subscribed client cursors on reconnect so missed frames require resync', () => {
    const hub = createHub()
    const socket = new FakeSocket()
    hub.addConnection('owner', socket, { authMode: 'owner' })
    hub.handleClientMessage('owner', { type: 'subscribe', sessionIds: ['session-a'] })
    socket.sent.length = 0

    hub.handleClientMessage('owner', {
      type: 'resume',
      cursors: {
        'session-a': { streamGeneration: 'generation-a', sequence: 3 },
        'session-unsubscribed': { streamGeneration: 'generation-a', sequence: 9 },
      },
    })
    hub.deliver(sessionDelivery(update('session-a', 5)))

    expect(socket.messages()).toEqual([
      {
        type: 'resume:ack',
        cursors: { 'session-a': { streamGeneration: 'generation-a', sequence: 3 } },
      },
      { type: 'resync_required', sessionId: 'session-a', reason: 'stream-cursor-gap' },
    ])
  })

  it('delivers Session completion after a cursor gap requires resync', () => {
    const hub = createHub()
    const socket = new FakeSocket()
    hub.addConnection('owner', socket, { authMode: 'owner' })
    hub.handleClientMessage('owner', { type: 'subscribe', sessionIds: ['session-a'] })
    socket.sent.length = 0

    hub.deliver(sessionDelivery(update('session-a', 1)))
    hub.deliver(sessionDelivery(update('session-a', 3)))
    hub.deliver(sessionDelivery(done('session-a', 4)))

    expect(socket.messages().map((message) => message.type)).toEqual([
      'session:update',
      'resync_required',
      'session:done',
    ])
  })

  it('does not report a gap while a contiguous cursor is still in flight', () => {
    const hub = createHub()
    const socket = new FakeSocket()
    hub.addConnection('owner', socket, { authMode: 'owner' })
    hub.handleClientMessage('owner', { type: 'subscribe', sessionIds: ['session-a'] })
    socket.sent.length = 0
    socket.autoComplete = false

    hub.deliver(sessionDelivery(update('session-a', 1)))
    hub.deliver(sessionDelivery(update('session-a', 2)))
    socket.completeNext()
    hub.deliver(sessionDelivery(update('session-a', 3)))
    socket.completeAll()

    expect(socket.messages().map((message) => message.type)).toEqual([
      'session:update',
      'session:update',
      'session:update',
    ])
  })

  it('removes subscriptions and queued state on disconnect', () => {
    const hub = createHub()
    const socket = new FakeSocket()
    hub.addConnection('owner', socket, { authMode: 'owner' })
    hub.handleClientMessage('owner', { type: 'subscribe', sessionIds: ['session-a'] })

    hub.removeConnection('owner')
    socket.sent.length = 0
    hub.deliver(sessionDelivery(update('session-a', 1)))

    expect(hub.connectionCount).toBe(0)
    expect(socket.sent).toEqual([])
  })
})

class FakeSocket implements RealtimeSocket {
  readonly OPEN = 1
  readyState = 1
  bufferedAmount = 0
  sent: string[] = []
  closed?: { code: number; reason: string }
  autoComplete = true
  private readonly callbacks: Array<(error?: Error) => void> = []

  send(payload: string, callback?: (error?: Error) => void): void {
    this.sent.push(payload)
    if (!callback) return
    if (this.autoComplete) callback()
    else this.callbacks.push(callback)
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason }
    this.readyState = 3
  }

  messages(): ServerMessage[] {
    return this.sent.map((payload) => JSON.parse(payload) as ServerMessage)
  }

  completeNext(): void {
    this.callbacks.shift()?.()
  }

  completeAll(): void {
    while (this.callbacks.length > 0) this.completeNext()
  }
}

function createHub(maxQueueMessages: number = 8): RealtimeHub {
  return new RealtimeHub({
    maxQueueMessages,
    maxQueueBytes: 64 * 1024,
    maxBufferedBytes: 64 * 1024,
    flushIntervalMs: 1,
  })
}

function sessionDelivery(message: ServerMessage): RealtimeDelivery {
  return { scope: 'session', sessionId: 'sessionId' in message ? message.sessionId : '', message }
}

function update(sessionId: string, sequence: number): Extract<ServerMessage, { type: 'session:update' }> {
  return {
    type: 'session:update',
    sessionId,
    agentId: 'agent-a',
    streamGeneration: 'generation-a',
    sequence,
    data: { messageId: 'msg-1', role: 'agent', contentDelta: `chunk-${sequence}` },
  }
}

function done(sessionId: string, sequence: number): Extract<ServerMessage, { type: 'session:done' }> {
  return {
    type: 'session:done',
    sessionId,
    agentId: 'agent-a',
    messageId: 'msg-1',
    stopReason: 'end_turn',
    streamGeneration: 'generation-a',
    sequence,
  }
}
