import { describe, expect, test } from 'vitest'
import { SessionUpdateActorScheduler, type ScheduleDrain } from '../../src/core/session-update-actors.js'
import type { SessionUpdateEnvelope } from '../../src/core/session-update-batcher.js'
import { events, flushSessionUpdates, type AppEvents } from '../../src/core/events.js'
import type { SessionUpdateData } from '../../src/types/ws-protocol.js'

function envelope(sessionId: string, messageId: string, data: Partial<SessionUpdateData> = {}): SessionUpdateEnvelope {
  return {
    sessionId,
    agentId: `agent-${sessionId}`,
    data: {
      messageId,
      role: 'agent',
      contentDelta: messageId,
      ...data,
    },
  }
}

function createControlledSchedule(): { scheduleDrain: ScheduleDrain; runNext: () => void; pendingCount: () => number } {
  const pending: Array<() => void> = []
  return {
    scheduleDrain: (drain) => {
      pending.push(drain)
    },
    runNext: () => {
      const next = pending.shift()
      if (!next) throw new Error('No scheduled drain pending')
      next()
    },
    pendingCount: () => pending.length,
  }
}

describe('SessionUpdateActorScheduler', () => {
  test('processes one session budget then yields to another active session', () => {
    const scheduled = createControlledSchedule()
    const applied: SessionUpdateEnvelope[] = []
    const scheduler = new SessionUpdateActorScheduler({
      eventBudgetPerSession: 2,
      scheduleDrain: scheduled.scheduleDrain,
      handleUpdate: (ev) => applied.push(ev),
    })

    scheduler.enqueue(envelope('noisy', 'n-1'))
    scheduler.enqueue(envelope('noisy', 'n-2'))
    scheduler.enqueue(envelope('noisy', 'n-3'))
    scheduler.enqueue(envelope('quiet', 'q-1'))

    expect(applied).toEqual([])

    scheduled.runNext()
    expect(applied.map((ev) => ev.data.messageId)).toEqual(['n-1', 'n-2'])

    scheduled.runNext()
    expect(applied.map((ev) => ev.data.messageId)).toEqual(['n-1', 'n-2', 'q-1'])

    scheduled.runNext()
    expect(applied.map((ev) => ev.data.messageId)).toEqual(['n-1', 'n-2', 'q-1', 'n-3'])
    expect(scheduled.pendingCount()).toBe(0)
  })

  test('flushSession synchronously drains one session in order only once', () => {
    const scheduled = createControlledSchedule()
    const applied: SessionUpdateEnvelope[] = []
    const scheduler = new SessionUpdateActorScheduler({
      eventBudgetPerSession: 1,
      scheduleDrain: scheduled.scheduleDrain,
      handleUpdate: (ev) => applied.push(ev),
    })

    scheduler.enqueue(envelope('sess-a', 'a-1'))
    scheduler.enqueue(envelope('sess-b', 'b-1'))
    scheduler.enqueue(envelope('sess-a', 'a-2'))

    scheduler.flushSession('sess-a')

    expect(applied.map((ev) => ev.data.messageId)).toEqual(['a-1', 'a-2'])

    scheduled.runNext()
    expect(applied.map((ev) => ev.data.messageId)).toEqual(['a-1', 'a-2', 'b-1'])
    expect(scheduled.pendingCount()).toBe(0)
  })

  test('critical updates flush pending updates for their session immediately', () => {
    const scheduled = createControlledSchedule()
    const applied: SessionUpdateEnvelope[] = []
    const scheduler = new SessionUpdateActorScheduler({
      eventBudgetPerSession: 1,
      scheduleDrain: scheduled.scheduleDrain,
      handleUpdate: (ev) => applied.push(ev),
    })

    scheduler.enqueue(envelope('critical-sess', 'chunk-1'))
    scheduler.enqueue(envelope('critical-sess', 'permission-1', {
      role: 'system',
      contentDelta: undefined,
      permissionRequest: {
        id: 'permission-1',
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      },
    }))

    expect(applied.map((ev) => ev.data.messageId)).toEqual(['chunk-1', 'permission-1'])
  })
})

describe('session update actor event bus wiring', () => {
  test('queues session:update outside the caller stack', () => {
    const received: string[] = []
    const handler = (ev: AppEvents['session:update']) => {
      received.push(ev.data.messageId ?? '')
    }
    events.on('session:update', handler)

    try {
      events.emit('session:update', envelope('event-sess', 'queued-1'))

      expect(received).toEqual([])

      flushSessionUpdates('event-sess')

      expect(received).toEqual(['queued-1'])
    } finally {
      events.off('session:update', handler)
    }
  })

  test('flushes pending session:update before session:done listeners run', () => {
    const observed: string[] = []
    const updateHandler = (ev: AppEvents['session:update']) => {
      observed.push(`update:${ev.data.messageId ?? ''}`)
    }
    const doneHandler = (ev: AppEvents['session:done']) => {
      observed.push(`done:${ev.messageId}`)
    }
    events.on('session:update', updateHandler)
    events.on('session:done', doneHandler)

    try {
      events.emit('session:update', envelope('done-sess', 'before-done'))
      events.emit('session:done', { sessionId: 'done-sess', agentId: 'agent-done-sess', messageId: 'done-1' })

      expect(observed).toEqual(['update:before-done', 'done:done-1'])
    } finally {
      events.off('session:update', updateHandler)
      events.off('session:done', doneHandler)
    }
  })
})
