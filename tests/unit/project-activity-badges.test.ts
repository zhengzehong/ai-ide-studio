import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { ProjectActivityBadges } from '../../ui/src/components/layout/ProjectActivityBadges.tsx'

describe('ProjectActivityBadges', () => {
  test('renders running and unread session counts with accessible labels', () => {
    const html = renderToStaticMarkup(createElement(ProjectActivityBadges, {
      stats: { projectId: 'project-a', runningCount: 3, unreadCount: 2 },
    }))

    expect(html).toContain('title="运行中会话：3"')
    expect(html).toContain('title="未读会话：2"')
    expect(html).toContain('>3<')
    expect(html).toContain('>2<')
  })

  test('renders nothing when the stats are unknown or both counts are zero', () => {
    expect(renderToStaticMarkup(createElement(ProjectActivityBadges, {}))).toBe('')
    expect(renderToStaticMarkup(createElement(ProjectActivityBadges, {
      stats: { projectId: 'project-a', runningCount: 0, unreadCount: 0 },
    }))).toBe('')
  })

  test('caps large counts and exposes compact mode', () => {
    const html = renderToStaticMarkup(createElement(ProjectActivityBadges, {
      stats: { projectId: 'project-a', runningCount: 100, unreadCount: 0 },
      compact: true,
    }))

    expect(html).toContain('99+')
    expect(html).toContain('project-activity-badges compact')
  })
})
