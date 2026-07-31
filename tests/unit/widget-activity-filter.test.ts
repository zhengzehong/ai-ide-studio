import { describe, expect, test } from 'vitest'
import { ACTIVITY_FILTERS, getNextActivityFilter } from '../../ui/src/pages/widget/activity-filter.js'

describe('Widget activity filter', () => {
  test('cycles through every state and returns to all', () => {
    expect(ACTIVITY_FILTERS.map((item) => item.value)).toEqual([
      'all',
      'running',
      'needs_input',
      'idle',
    ])
    expect(getNextActivityFilter('all')).toBe('running')
    expect(getNextActivityFilter('running')).toBe('needs_input')
    expect(getNextActivityFilter('needs_input')).toBe('idle')
    expect(getNextActivityFilter('idle')).toBe('all')
  })

  test('uses compact labels suitable for the Widget footer', () => {
    expect(ACTIVITY_FILTERS.map((item) => item.label)).toEqual([
      '全部',
      '运行中',
      '待处理',
      '已完成',
    ])
  })
})

