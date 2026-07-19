import { describe, expect, it } from 'vitest'
import { RealtimeOutboundQueue } from '../../src/realtime/outbound-queue.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

describe('RealtimeOutboundQueue', () => {
  it('coalesces text deltas and latest-wins process item updates', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 4, maxBytes: 16_384 })

    queue.enqueue(update('hello ', 1))
    queue.enqueue(update('world', 2))
    queue.enqueue(processItem('running'))
    queue.enqueue(processItem('completed'))

    expect(queue.size).toBe(2)
    expect(queue.drain().map((item) => item.message)).toEqual([
      update('hello world', 2),
      processItem('completed'),
    ])
  })

  it('bounds noncritical traffic and emits one resync marker on overflow', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 2, maxBytes: 16_384 })

    expect(queue.enqueue(update('first', 1)).accepted).toBe(true)
    expect(queue.enqueue(update('second', 2, 'msg-2')).accepted).toBe(true)
    expect(queue.enqueue(update('third', 3, 'msg-3'))).toMatchObject({
      accepted: false,
      resyncRequired: true,
    })
    expect(queue.enqueue(update('fourth', 4, 'msg-4')).accepted).toBe(false)

    const messages = queue.drain().map((item) => item.message)
    expect(messages.filter((message) => message.type === 'resync_required')).toHaveLength(1)
  })

  it('preserves critical FIFO by evicting coalescible frames first', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 2, maxBytes: 16_384 })
    queue.enqueue(update('drop-me', 1))
    queue.enqueue(done('done-1', 2))

    const result = queue.enqueue(done('done-2', 3))

    expect(result).toMatchObject({ accepted: true, closeRecommended: false })
    expect(queue.drain().map((item) => item.message)).toEqual([
      done('done-1', 2),
      done('done-2', 3),
    ])
  })

  it('recommends closing when one critical frame exceeds the byte limit', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 2, maxBytes: 32 })

    expect(queue.enqueue(done('x'.repeat(100), 1))).toMatchObject({
      accepted: false,
      closeRecommended: true,
      resyncRequired: true,
    })
  })
})

function update(delta: string, sequence: number, messageId = 'msg-1'): ServerMessage {
  return {
    type: 'session:update',
    sessionId: 'session-a',
    agentId: 'agent-a',
    streamGeneration: 'generation-a',
    sequence,
    data: { messageId, role: 'agent', contentDelta: delta },
  }
}

function processItem(status: string): ServerMessage {
  return {
    type: 'session:process_item',
    sessionId: 'session-a',
    agentId: 'agent-a',
    item: {
      id: 'item-a',
      session_id: 'session-a',
      message_id: 'msg-1',
      sequence: 1,
      kind: 'tool',
      status,
      title: 'Tool',
      summary: null,
      preview: null,
      content: null,
      meta_json: null,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    },
  }
}

function done(messageId: string, sequence: number): ServerMessage {
  return {
    type: 'session:done',
    sessionId: 'session-a',
    agentId: 'agent-a',
    messageId,
    streamGeneration: 'generation-a',
    sequence,
  }
}
