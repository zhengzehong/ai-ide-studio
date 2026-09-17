import { describe, expect, it } from 'vitest'
import { RealtimeOutboundQueue } from '../../src/realtime/outbound-queue.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

describe('RealtimeOutboundQueue', () => {
  it('delivers recovery RPC results and heartbeats while realtime deltas are paused', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 8, maxBytes: 4096 })
    queue.enqueueResync('session-a', 'test-gap')
    queue.drain()
    expect(queue.enqueue({ type: 'result', requestId: 'history', data: [] }).accepted).toBe(true)
    expect(queue.enqueue({ type: 'pong', timestamp: 123 }).accepted).toBe(true)
    expect(queue.enqueue(update('paused', 1)).accepted).toBe(false)
    expect(queue.drain().map(frame => frame.message.type)).toEqual(['result', 'pong'])
    queue.acknowledgeResync()
    expect(queue.enqueue(update('resumed', 2)).accepted).toBe(true)
  })

  it('returns a correlated error for oversized RPC results instead of losing the request', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 8, maxBytes: 1024 })
    queue.enqueue({ type: 'result', requestId: 'large-history', data: 'x'.repeat(2048) })
    expect(queue.drain().map(frame => frame.message)).toEqual([
      expect.objectContaining({ type: 'error', requestId: 'large-history' }),
    ])
  })

  it('truncates an oversized list result to fit instead of rejecting it (P1)', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 8, maxBytes: 2048 })
    // 模拟 sessions.events:裸数组、按下标升序,超限时应保留尾部(最新)而不是整条拒掉
    const events = Array.from({ length: 200 }, (_, index) => ({ sequence: index + 1, type: 'lifecycle.prompt_sent', payload: 'x'.repeat(40) }))

    const result = queue.enqueue({ type: 'result', requestId: 'events-page', data: events })

    expect(result).toMatchObject({ accepted: true, resyncRequired: false })
    const frames = queue.drain()
    expect(frames).toHaveLength(1)
    const delivered = frames[0]?.message
    expect(delivered?.type).toBe('result')
    const kept = (delivered as { data: { sequence: number }[] }).data
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(events.length)
    // 保留的是尾部:最后一条必须是原数组最后一条
    expect(kept.at(-1)?.sequence).toBe(200)
    expect(frames[0]?.byteLength).toBeLessThanOrEqual(2048)
  })

  it('marks a truncated object result with a cursor-friendly flag', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 8, maxBytes: 3072 })
    const items = Array.from({ length: 100 }, (_, index) => ({ id: `m-${index}`, content: 'y'.repeat(60) }))

    expect(queue.enqueue({
      type: 'result',
      requestId: 'messages-page',
      data: { sessionId: 'session-a', items, hasMore: false, nextCursor: null },
    }).accepted).toBe(true)

    const message = queue.drain()[0]?.message as { data: { items: unknown[]; truncated?: boolean; droppedCount?: number; hasMore?: boolean; sessionId: string } }
    expect(message.data.truncated).toBe(true)
    expect(message.data.hasMore).toBe(true)
    expect(message.data.droppedCount).toBeGreaterThan(0)
    expect(message.data.sessionId).toBe('session-a')
    expect(message.data.items.length).toBeGreaterThan(0)
    expect(message.data.items.at(-1)).toMatchObject({ id: 'm-99' })
  })

  it('suppresses duplicate oversized results for the same request id', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 8, maxBytes: 1024 })
    const oversized: ServerMessage = { type: 'result', requestId: 'huge-object', data: { blob: 'x'.repeat(4096) } }

    // 首次:超限对象无法截断 → 回一条 correlated error(沿用原行为)
    expect(queue.enqueue(oversized).accepted).toBe(true)
    expect(queue.drain().map((frame) => frame.message.type)).toEqual(['error'])
    // 同一 requestId 重发:不再回第二条错误帧(避免重试风暴刷屏)
    expect(queue.enqueue(oversized).accepted).toBe(false)
    expect(queue.drain()).toEqual([])
  })

  it('fails the connection explicitly if control replies cannot fit without loss', () => {
    const queue = new RealtimeOutboundQueue({ maxMessages: 1, maxBytes: 1024 })
    queue.enqueue({ type: 'result', requestId: 'first', data: [] })
    expect(queue.enqueue({ type: 'result', requestId: 'second', data: [] }).closeRecommended).toBe(true)
    expect(queue.bytes).toBeLessThanOrEqual(1024)
  })

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
