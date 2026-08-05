import { describe, expect, test } from 'vitest'
import {
  ACTIVITY_FILTERS,
  getNextActivityFilter,
  matchesActivityFilter,
} from '../../ui/src/pages/widget/activity-filter.js'

describe('Widget activity filter', () => {
  test('cycles through every attention state and returns to all', () => {
    expect(ACTIVITY_FILTERS.map((item) => item.value)).toEqual([
      'all',
      'running',
      'unread',
    ])
    expect(getNextActivityFilter('all')).toBe('running')
    expect(getNextActivityFilter('running')).toBe('unread')
    expect(getNextActivityFilter('unread')).toBe('all')
  })

  test('uses compact labels suitable for the Widget footer', () => {
    expect(ACTIVITY_FILTERS.map((item) => item.label)).toEqual([
      '全部',
      '运行中',
      '未读',
    ])
  })

  test('filters by independent Session flags instead of the display state alone', () => {
    const session = {
      sessionId: 'session-1', taskId: 'task-1', taskTitle: 'Task', taskStatus: 'needs_input',
      sessionTitle: 'Session', status: 'active', stage: '', activityAt: '2026-08-03T00:00:00.000Z',
      attentionState: 'running' as const, running: true, unread: true,
    }

    expect(matchesActivityFilter(session, 'running')).toBe(true)
    expect(matchesActivityFilter(session, 'unread')).toBe(true)
  })
})
