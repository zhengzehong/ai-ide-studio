import { describe, expect, test } from 'vitest'
import { calculateVirtualRange } from '../../ui/src/components/chat/virtual-range.ts'

describe('calculateVirtualRange', () => {
  test('returns a bounded visible range with overscan', () => {
    const range = calculateVirtualRange(200, new Map(), 960, 480, 96, 3)

    expect(range.start).toBeGreaterThanOrEqual(0)
    expect(range.end).toBeLessThanOrEqual(200)
    expect(range.end - range.start).toBeLessThan(20)
    expect(range.top).toBeGreaterThanOrEqual(0)
    expect(range.bottom).toBeGreaterThanOrEqual(0)
  })

  test('uses measured heights and never returns negative spacers', () => {
    const heights = new Map<number, number>([
      [0, 300],
      [1, 40],
      [2, 40],
    ])

    const range = calculateVirtualRange(3, heights, 100, 120, 50, 2)

    expect(range.start).toBe(0)
    expect(range.end).toBe(3)
    expect(range.top).toBe(0)
    expect(range.bottom).toBe(0)
  })
})
