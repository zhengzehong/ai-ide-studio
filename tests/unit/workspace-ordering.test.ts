import { describe, expect, test } from 'vitest'
import { moveItemById, sortWorkspaceItems } from '../../ui/src/pages/workspace/ordering.ts'

describe('workspace ordering helpers', () => {
  test('sorts items by custom order with stable fallback order', () => {
    const items = [
      { id: 'new-without-order', created_at: '2026-01-03T00:00:00.000Z' },
      { id: 'second', sort_order: 2, created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'first', sort_order: 1, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'old-without-order', created_at: '2026-01-01T00:00:00.000Z' },
    ]

    expect(sortWorkspaceItems(items).map((item) => item.id)).toEqual([
      'first',
      'second',
      'old-without-order',
      'new-without-order',
    ])
  })

  test('moves an item by id to a target index', () => {
    expect(moveItemById(['a', 'b', 'c', 'd'], 'c', 0)).toEqual(['c', 'a', 'b', 'd'])
    expect(moveItemById(['a', 'b', 'c', 'd'], 'b', 3)).toEqual(['a', 'c', 'd', 'b'])
  })

  test('leaves order unchanged for missing ids or same index', () => {
    expect(moveItemById(['a', 'b', 'c'], 'x', 0)).toEqual(['a', 'b', 'c'])
    expect(moveItemById(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
  })
})
