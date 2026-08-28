import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import { PinnedSessions } from '../../ui/src/pages/PinnedSessions'
import { useSessionDockStore } from '../../ui/src/stores/session-dock.store'
import { PinnedSessionList, PinnedSessionRow } from '../../mobile/src/pages/PinnedSessionsPage'
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

  test('renders the mobile pinned row with swipe-to-unpin instead of button column', () => {
    const html = renderToStaticMarkup(createElement(PinnedSessionRow, {
      item,
      removing: false,
      dragY: 0,
      dragActive: false,
      liftX: 0,
      liftAnimating: false,
      onOpen: () => undefined,
      onRemove: () => undefined,
    }))

    expect(html).toContain('AI IDE Studio · 编码智能体')
    expect(html).toContain('运行中')
    expect(html).toContain('data-pin-id="session-1"')
    expect(html).toContain('aria-label="取消置顶"')
    // 上下箭头/置顶按钮列已移除,排序改长按拖拽、取消置顶改左滑
    expect(html).not.toContain('aria-label="上移"')
    expect(html).not.toContain('aria-label="下移"')
  })

  test('renders the embedded mobile pinned list without its own page header', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PinnedSessionList)))

    expect(html).toContain('还没有置顶会话')
    expect(html).not.toContain('跨项目持续关注')
  })

  test('uses activity, sessions, tasks, and settings as the mobile tab bar', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(MobileShell)))

    expect(html.indexOf('>动态<')).toBeLessThan(html.indexOf('>会话<'))
    expect(html.indexOf('>会话<')).toBeLessThan(html.indexOf('>任务<'))
    expect(html.indexOf('>任务<')).toBeLessThan(html.indexOf('>设置<'))
    expect(html).not.toContain('>置顶<')
    expect(html).not.toContain('>秘书<')
  })
})
