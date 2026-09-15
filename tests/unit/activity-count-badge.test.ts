import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { ActivityCountBadge } from '../../ui/src/components/session/ActivityCountBadge.tsx'
import { resolveTeamActivityCounts } from '../../ui/src/utils/team-activity-counts.ts'
import type { TeamActivitySummary } from '../../src/shared/team-activity.ts'

function render(props: { running: number; unread: number; total: number; titles?: { running?: string; unread?: string; total?: string } }): string {
  return renderToStaticMarkup(createElement(ActivityCountBadge, props))
}

describe('ActivityCountBadge', () => {
  test('renders the running tier with a green count', () => {
    const html = render({ running: 2, unread: 0, total: 5 })
    expect(html).toContain('title="运行中会话"')
    expect(html).toContain('>2<')
    expect(html).toContain('var(--green)')
    expect(html).not.toContain('var(--text-3)')
  })

  test('renders the unread tier when nothing is running', () => {
    const html = render({ running: 0, unread: 3, total: 5 })
    expect(html).toContain('title="未读会话"')
    expect(html).toContain('>3<')
    expect(html).toContain('var(--yellow)')
  })

  test('falls back to the gray total when idle and read', () => {
    const html = render({ running: 0, unread: 0, total: 4 })
    expect(html).toContain('title="会话总数"')
    expect(html).toContain('>4<')
    expect(html).toContain('var(--text-3)')
  })

  test('renders nothing when the team has no counts at all', () => {
    expect(render({ running: 0, unread: 0, total: 0 })).toBe('')
  })

  test('caps large counts and accepts per-surface titles', () => {
    const html = render({ running: 120, unread: 0, total: 200, titles: { running: '运行中团队会话' } })
    expect(html).toContain('99+')
    expect(html).toContain('title="运行中团队会话"')
  })

  test('keeps running and unread visible together, like the agent row', () => {
    const html = render({ running: 2, unread: 1, total: 6 })
    expect(html).toContain('title="运行中会话"')
    expect(html).toContain('title="未读会话"')
  })
})

describe('resolveTeamActivityCounts', () => {
  const base: TeamActivitySummary = {
    teamId: 'team-a',
    projectId: 'project-a',
    running: false,
    unread: false,
    conversations: [],
  }

  test('prefers server counts when present', () => {
    expect(resolveTeamActivityCounts({ ...base, running: true, unread: true, runningCount: 2, unreadCount: 3, total: 5 }))
      .toEqual({ running: 2, unread: 3, total: 5 })
  })

  test('falls back to booleans and line count on an old server without count fields', () => {
    const conversations = [
      { conversationId: 'c1', running: false, unread: false, lastMessageAt: null, sessionIds: ['s1'] },
      { conversationId: 'c2', running: false, unread: false, lastMessageAt: null, sessionIds: ['s2'] },
    ]
    expect(resolveTeamActivityCounts({ ...base, running: true, unread: true, conversations }))
      .toEqual({ running: 1, unread: 1, total: 2 })
  })

  test('returns zeros without a summary', () => {
    expect(resolveTeamActivityCounts(undefined)).toEqual({ running: 0, unread: 0, total: 0 })
  })
})
