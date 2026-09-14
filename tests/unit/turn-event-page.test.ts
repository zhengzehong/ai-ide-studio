import { describe, expect, it } from 'vitest'
import { DEFAULT_TURN_EVENT_PAGE_BUDGET, MAX_TURN_EVENT_PAGE_BUDGET, pageTurnEvents, resolveTurnEventPageBudget } from '../../src/queries/turn-event-page.js'
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
  it('keeps the historical default budget when no client budget is provided', () => {
    expect(pageTurnEvents(rows, 0, 3).items.map(row => row.sequence)).toEqual([1])
    expect(DEFAULT_TURN_EVENT_PAGE_BUDGET).toEqual({ maxItems: 100, maxBytes: 128 * 1024 })
  })
  it('pages a wide budget in fewer round trips (mobile replay profile) and keeps the boundary intact', () => {
    const events = Array.from({ length: 150 }, (_, index) => ({ id: `e${index + 1}`, sequence: index + 1, payload_json: 'y'.repeat(1_000) } as SessionEventRow))
    const first = pageTurnEvents(events, 0, 150, { maxItems: 500, maxBytes: 512 * 1024 })
    expect(first.items).toHaveLength(150)
    expect(first.hasMore).toBe(false)
    // 同一批数据在默认预算下要多页才能取完
    expect(pageTurnEvents(events, 0, 150).hasMore).toBe(true)
  })
  it('clamps a requested budget to the server ceiling and falls back on invalid values', () => {
    expect(resolveTurnEventPageBudget({ maxItems: 5000, maxBytes: 8 * 1024 * 1024 })).toEqual(MAX_TURN_EVENT_PAGE_BUDGET)
    expect(resolveTurnEventPageBudget({ maxItems: 0, maxBytes: -1 })).toEqual(DEFAULT_TURN_EVENT_PAGE_BUDGET)
    expect(resolveTurnEventPageBudget({ maxItems: 500, maxBytes: 512 * 1024 })).toEqual({ maxItems: 500, maxBytes: 512 * 1024 })
    const oversized = Array.from({ length: 1200 }, (_, index) => ({ id: `e${index + 1}`, sequence: index + 1, payload_json: 'z' } as SessionEventRow))
    const page = pageTurnEvents(oversized, 0, 1200, resolveTurnEventPageBudget({ maxItems: 5000 }))
    expect(page.items).toHaveLength(MAX_TURN_EVENT_PAGE_BUDGET.maxItems)
    expect(page.hasMore).toBe(true)
  })
})
