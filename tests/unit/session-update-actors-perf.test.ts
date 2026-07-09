import { describe, expect, test } from 'vitest'
import { SessionUpdateActorScheduler, type ScheduleDrain } from '../../src/core/session-update-actors.js'
import type { SessionUpdateEnvelope } from '../../src/core/session-update-batcher.js'

function envelope(sessionId: string, index: number): SessionUpdateEnvelope {
  return {
    sessionId,
    agentId: `agent-${sessionId}`,
    data: {
      messageId: `${sessionId}-${index}`,
      role: 'agent',
      contentDelta: `${index}`,
    },
  }
}

function controlledSchedule(): { scheduleDrain: ScheduleDrain; drainAll: () => void } {
  const pending: Array<() => void> = []
  return {
    scheduleDrain: (drain) => {
      pending.push(drain)
    },
    drainAll: () => {
      while (pending.length > 0) {
        const next = pending.shift()
        if (next) next()
      }
    },
  }
}

describe('SessionUpdateActorScheduler fairness under noisy sessions', () => {
  test('handles a quiet session before a noisy session drains completely', () => {
    const scheduled = controlledSchedule()
    const applied: string[] = []
    const scheduler = new SessionUpdateActorScheduler({
      eventBudgetPerSession: 10,
      scheduleDrain: scheduled.scheduleDrain,
      handleUpdate: (ev) => applied.push(`${ev.sessionId}:${ev.data.messageId ?? ''}`),
    })

    for (let i = 1; i <= 100; i++) {
      scheduler.enqueue(envelope('noisy', i))
    }
    scheduler.enqueue(envelope('quiet', 1))

    scheduled.drainAll()

    const quietIndex = applied.indexOf('quiet:quiet-1')
    expect(quietIndex).toBeGreaterThanOrEqual(0)
    expect(quietIndex).toBeLessThan(100)
    expect(applied.slice(0, 11)).toEqual([
      'noisy:noisy-1',
      'noisy:noisy-2',
      'noisy:noisy-3',
      'noisy:noisy-4',
      'noisy:noisy-5',
      'noisy:noisy-6',
      'noisy:noisy-7',
      'noisy:noisy-8',
      'noisy:noisy-9',
      'noisy:noisy-10',
      'quiet:quiet-1',
    ])
  })
})
