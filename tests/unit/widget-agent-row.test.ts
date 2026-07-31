import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { WidgetAgentRow } from '../../ui/src/pages/widget/WidgetAgentRow.js'

const baseActivity = {
  sessionId: 'session-1',
  agentId: 'agent-1',
  agentName: 'Codex',
  agentIcon: null,
  projectId: 'project-1',
  projectName: 'Project',
  taskId: null,
  taskTitle: null,
  taskStatus: null,
  sessionTitle: '主会话',
  status: 'active',
  activityState: 'idle' as const,
  stage: '',
  unread: false,
  startedAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  lastMessageAt: '2026-07-31T00:00:00.000Z',
  completedAt: '2026-07-31T00:00:00.000Z',
  closedAt: null,
  activityAt: '2026-07-31T00:00:00.000Z',
  unreadCount: 0,
}

describe('Widget Agent row', () => {
  test('does not present a Session title as a Task', () => {
    const html = renderToStaticMarkup(createElement(WidgetAgentRow, {
      activity: baseActivity,
      onClick: vi.fn(),
    }))

    expect(html).not.toContain('widget-linked-task')
    expect(html).not.toContain('主会话')
  })

  test('renders the assigned Task when one is available today', () => {
    const html = renderToStaticMarkup(createElement(WidgetAgentRow, {
      activity: {
        ...baseActivity,
        taskId: 'task-1',
        taskTitle: '修复 Widget 跳转',
        taskStatus: 'running',
      },
      onClick: vi.fn(),
    }))

    expect(html).toContain('widget-linked-task')
    expect(html).toContain('修复 Widget 跳转')
  })
})
