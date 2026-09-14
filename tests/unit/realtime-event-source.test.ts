import { afterEach, describe, expect, it, vi } from 'vitest'
import { events } from '../../src/core/events.js'
import { createRealtimeEventSource } from '../../src/gateway/realtime-event-source.js'
import type { RealtimeDelivery } from '../../src/realtime/protocol.js'

afterEach(() => vi.useRealTimers())

describe('Realtime event source', () => {
  it('maps session and global events and detaches every listener on stop', async () => {
    vi.useFakeTimers()
    const deliveries: RealtimeDelivery[] = []
    const source = createRealtimeEventSource((delivery) => {
      deliveries.push(delivery)
    }, { textFlushMs: 1, processFlushMs: 1 })

    events.emit('session:update', {
      sessionId: 'session-a',
      agentId: 'agent-a',
      data: { messageId: 'message-a', role: 'agent', contentDelta: 'hello' },
    })
    events.emit('task:update', { taskId: 'task-a', data: { status: 'running' } })
    events.emit('session-dock:update', { action: 'added', sessionId: 'session-a' })
    await vi.advanceTimersByTimeAsync(1)

    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'session',
        sessionId: 'session-a',
        message: expect.objectContaining({ type: 'session:update' }),
      }),
      expect.objectContaining({
        scope: 'all',
        message: expect.objectContaining({ type: 'task:update', taskId: 'task-a' }),
      }),
      expect.objectContaining({
        scope: 'all',
        message: expect.objectContaining({
          type: 'session-dock:update',
          action: 'added',
          sessionId: 'session-a',
        }),
      }),
    ]))

    source.stop()
    const count = deliveries.length
    events.emit('task:update', { taskId: 'task-after-stop', data: {} })
    expect(deliveries).toHaveLength(count)
  })

  it('keeps runtime-sourced autonomous idle off the WS stream while broadcasting ordinary activity', () => {
    const deliveries: RealtimeDelivery[] = []
    const source = createRealtimeEventSource((delivery) => {
      deliveries.push(delivery)
    })

    events.emit('session:activity', {
      sessionId: 'session-a',
      agentId: 'agent-a',
      state: 'idle',
      reason: 'autonomous-done',
      timestamp: new Date().toISOString(),
      source: 'runtime',
    })
    events.emit('session:activity', {
      sessionId: 'session-a',
      agentId: 'agent-a',
      state: 'running',
      reason: 'prompt-start',
      timestamp: new Date().toISOString(),
    })

    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toEqual(expect.objectContaining({
      scope: 'all',
      message: expect.objectContaining({ type: 'session:activity', reason: 'prompt-start' }),
    }))
    source.stop()
  })
})
