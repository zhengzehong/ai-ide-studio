import { describe, expect, it } from 'vitest'
import { readSessionRecovery } from '../../src/queries/session-recovery-query.js'
import type { SessionRecoverySnapshot } from '../../src/ports/query-port.js'

describe('session recovery query diagnostics', () => {
  it('reports phase timings without changing the recovery snapshot', () => {
    const events = [{ sequence: 7 }, { sequence: 8 }] as SessionRecoverySnapshot['events']
    const clock = createClock([10, 13, 24])

    const result = readSessionRecovery(
      { sessionId: 'session-1', limit: 20 },
      {
        latestSequence: () => 8,
        listRecovery: () => events,
        now: clock.now,
      },
    )

    expect(result.snapshot).toEqual({
      sessionId: 'session-1',
      latestSequence: 8,
      events,
    })
    expect(result.diagnostics).toEqual({
      operation: 'sessions.recovery',
      sessionId: 'session-1',
      latestSequenceMs: 3,
      eventsMs: 11,
      totalMs: 14,
      eventCount: 2,
    })
  })
})

function createClock(values: number[]): { now(): number } {
  let index = 0
  return {
    now: () => values[Math.min(index++, values.length - 1)],
  }
}
