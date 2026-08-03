import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { WidgetAgentProjectGroup } from '../../ui/src/pages/widget/WidgetAgentProjectGroup.js'
import { formatCompactTimeAgo } from '../../ui/src/pages/widget/format.js'
import type { WidgetAgentProjectActivityGroup } from '../../ui/src/stores/widget.store.js'

const group: WidgetAgentProjectActivityGroup = {
  groupId: 'agent-1:project-1',
  agentId: 'agent-1',
  agentName: 'coder-codex',
  agentIcon: null,
  projectId: 'project-1',
  projectName: 'AI IDE Studio',
  activityAt: '2026-08-03T08:03:00.000Z',
  sessions: [
    {
      sessionId: 'session-running',
      taskId: 'task-1',
      taskTitle: '排查首次文件预览未展示',
      taskStatus: 'running',
      sessionTitle: '构建最新 PRD',
      status: 'active',
      stage: '',
      running: true,
      unread: false,
      needsInput: false,
      attentionState: 'running',
      activityAt: '2026-08-03T08:03:00.000Z',
    },
    {
      sessionId: 'session-unread',
      taskId: 'task-2',
      taskTitle: '多会话活动展示方案',
      taskStatus: 'completed',
      sessionTitle: '桌面浮窗优化',
      status: 'active',
      stage: '',
      running: false,
      unread: true,
      needsInput: false,
      attentionState: 'unread',
      activityAt: '2026-08-03T08:02:00.000Z',
    },
  ],
}

describe('Widget Session activity row', () => {
  test('renders Agent and project once with every Session on a single line', () => {
    const html = renderToStaticMarkup(createElement(WidgetAgentProjectGroup, {
      group,
      onSessionClick: vi.fn(),
    }))

    expect(html.match(/coder-codex/g)).toHaveLength(1)
    expect(html.match(/AI IDE Studio/g)).toHaveLength(1)
    expect(html).toContain('执行中')
    expect(html).toContain('构建最新 PRD')
    expect(html).toContain('排查首次文件预览未展示')
    expect(html).toContain('未读')
    expect(html).toContain('桌面浮窗优化')
    expect(html.match(/widget-session-activity-row/g)).toHaveLength(2)
    expect(html).not.toContain('<br')
    expect(html).not.toContain('lucide-git-branch')
  })

  test('shows an explicit fallback for missing project and Session titles', () => {
    const html = renderToStaticMarkup(createElement(WidgetAgentProjectGroup, {
      group: {
        ...group,
        projectId: null,
        projectName: null,
        sessions: [{ ...group.sessions[0]!, sessionTitle: null }],
      },
      onSessionClick: vi.fn(),
    }))

    expect(html).toContain('未归属项目')
    expect(html).toContain('未命名会话')
  })

  test('uses compact time labels that fit the 300px Widget', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T08:30:00.000Z'))
    try {
      expect(formatCompactTimeAgo('2026-08-03T08:29:45.000Z')).toBe('刚刚')
      expect(formatCompactTimeAgo('2026-08-03T08:06:00.000Z')).toBe('24分')
      expect(formatCompactTimeAgo('2026-08-03T05:30:00.000Z')).toBe('3时')
      expect(formatCompactTimeAgo('2026-07-31T08:30:00.000Z')).toBe('3天')
    } finally {
      vi.useRealTimers()
    }
  })
})
