import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import {
  GlobalAssistantRail,
  SessionDockLauncher,
} from '../../ui/src/components/global-assistant/GlobalAssistantRail.js'
import { SessionDockDrawer } from '../../ui/src/components/session-dock/SessionDockDrawer.js'
import { SessionDockRow } from '../../ui/src/components/session-dock/SessionDockRow.js'
import {
  formatSessionDockTime,
  sessionDockWorkspacePath,
} from '../../ui/src/components/session-dock/session-dock-format.js'
import type { SessionDockItem } from '../../ui/src/stores/session-dock.store'

const item: SessionDockItem = {
  sessionId: 'session-1',
  sessionTitle: '核心会话稳定性',
  stage: '等待验证',
  agentId: 'agent-1',
  agentName: '编码智能体',
  agentIcon: 'code',
  agentAvatarUrl: null,
  projectId: 'project-1',
  projectName: 'AI IDE Studio',
  projectColor: '#dcfce7',
  projectIcon: 'A',
  activityState: 'idle',
  unread: true,
  lastActivityAt: '2026-08-05T06:00:00.000Z',
  sortOrder: 1,
  addedAt: '2026-08-05T05:00:00.000Z',
}

describe('global Session dock UI', () => {
  test('renders a compact cross-project row with status and removal control', () => {
    const html = renderToStaticMarkup(createElement(SessionDockRow, {
      item,
      removing: false,
      reordering: false,
      onOpen: () => undefined,
      onRemove: () => undefined,
      onDragStart: () => undefined,
      onDragOver: () => undefined,
      onDrop: () => undefined,
    }))

    expect(html).toContain('核心会话稳定性')
    expect(html).toContain('AI IDE Studio')
    expect(html).toContain('编码智能体')
    expect(html).toContain('未读')
    expect(html).toContain('aria-label="移出全局会话"')
  })

  test('renders the dock drawer as a separate global surface', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SessionDockDrawer)))

    expect(html).toContain('全局会话')
    expect(html).toContain('0 个固定')
    expect(html).toContain('aria-label="添加会话"')
    expect(html).toContain('aria-label="关闭"')
  })

  test('adds a second launcher to the existing global rail', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(GlobalAssistantRail)))

    expect(html).toContain('aria-label="全局会话"')
    expect(html).toContain('session-dock-rail-button')
  })

  test('shows running and unread state on the global Session launcher', () => {
    const html = renderToStaticMarkup(createElement(SessionDockLauncher, {
      open: true,
      running: true,
      unreadCount: 12,
      onClick: () => undefined,
    }))

    expect(html).toContain('global-assistant-avatar--active')
    expect(html).toContain('session-dock-state-dot')
    expect(html).toContain('session-dock-unread-badge')
    expect(html).toContain('9+')
  })

  test('builds the canonical cross-project Workspace route', () => {
    expect(sessionDockWorkspacePath('project one', 'session/1')).toBe(
      '/p/project%20one/workspace?sessionId=session%2F1',
    )
    expect(formatSessionDockTime('2026-08-05T05:30:00.000Z', Date.parse('2026-08-05T06:00:00.000Z'))).toBe('30 分钟前')
  })
})
