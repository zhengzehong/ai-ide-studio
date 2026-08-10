import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import { PinnedSessions } from '../../ui/src/pages/PinnedSessions'
import { useSessionDockStore } from '../../ui/src/stores/session-dock.store'
import { PinnedSessionRow, PinnedSessionsPage } from '../../mobile/src/pages/PinnedSessionsPage'
import { usePinnedSessionStore } from '../../mobile/src/stores/pinned-session.store'
import MobileShell from '../../mobile/src/components/MobileShell'

const item = {
  sessionId: 'session-1',
  sessionTitle: '发布前检查',
  stage: '等待验证',
  agentId: 'agent-1',
  agentName: '编码智能体',
  agentIcon: 'code',
  agentAvatarUrl: null,
  projectId: 'project-1',
  projectName: 'AI IDE Studio',
  projectColor: '#dcfce7',
  projectIcon: 'A',
  activityState: 'running' as const,
  unread: true,
  lastActivityAt: '2026-08-10T06:00:00.000Z',
  sortOrder: 1,
  addedAt: '2026-08-10T05:00:00.000Z',
}

beforeEach(() => {
  useSessionDockStore.setState({ items: [item], loaded: true, loading: false, pickerOpen: false, error: null })
  usePinnedSessionStore.setState({ items: [item], loaded: true, loading: false, error: null, removing: {}, reordering: false })
})

describe('pinned session surfaces', () => {
  test('renders the desktop page as an independent pinned surface', () => {
    expect(useSessionDockStore.getState().items).toHaveLength(1)
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PinnedSessions)))

    expect(html).toContain('置顶会话')
    expect(html).toContain('添加会话')
  })

  test('renders the mobile pinned tab with cross-project metadata', () => {
    const html = renderToStaticMarkup(createElement(PinnedSessionRow, {
      item,
      index: 0,
      total: 1,
      removing: false,
      reordering: false,
      onOpen: () => undefined,
      onRemove: () => undefined,
      onMove: () => undefined,
    }))

    expect(html).toContain('AI IDE Studio · 编码智能体')
    expect(html).toContain('运行中')
    expect(html).toContain('aria-label="取消置顶"')
  })

  test('renders the mobile pinned page empty state with a path back to sessions', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PinnedSessionsPage)))

    expect(html).toContain('置顶会话')
    expect(html).toContain('去会话页')
  })

  test('puts pinned before normal sessions in the mobile tab bar', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(MobileShell)))

    expect(html.indexOf('>置顶<')).toBeLessThan(html.indexOf('>会话<'))
    expect(html.indexOf('>会话<')).toBeLessThan(html.indexOf('>任务<'))
    expect(html.indexOf('>任务<')).toBeLessThan(html.indexOf('>设置<'))
  })
})
