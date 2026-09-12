import { describe, expect, it } from 'vitest'
import { pageTurnEvents } from '../../src/queries/turn-event-page.js'
import type { SessionEventRow } from '../../src/store/sessions.js'

describe('bounded turn event recovery', () => {
  const rows = [1, 2, 3].map(sequence => ({ id: String(sequence), sequence, payload_json: 'x'.repeat(70_000) } as SessionEventRow))
  it('pages within a fixed recovery boundary without losing or duplicating events', () => {
    const first = pageTurnEvents(rows, 0, 2)
    expect(first.items.map(row => row.sequence)).toEqual([1])
    expect(first.hasMore).toBe(true)
    const second = pageTurnEvents(rows, first.nextSequence, 2)
    expect(second.items.map(row => row.sequence)).toEqual([2])
    expect(second.hasMore).toBe(false)
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(256 * 1024)
  })
  it('rejects an oversized individual event explicitly', () => {
    expect(() => pageTurnEvents([{ ...rows[0], payload_json: 'x'.repeat(2_100_000) }], 0, 2)).toThrow('过大')
  })
})
