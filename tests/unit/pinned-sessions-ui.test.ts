import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import { PinnedSessions } from '../../ui/src/pages/PinnedSessions'
import { useSessionDockStore } from '../../ui/src/stores/session-dock.store'
import { PinnedGroupCard, PinnedSessionList, PinnedSessionRow, groupPinnedItems } from '../../mobile/src/pages/PinnedSessionsPage'
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

  test('renders the mobile pinned row with activity-style ListRow and swipe-to-unpin', () => {
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

    expect(html).toContain('发布前检查')
    // 状态词与动态页对齐:running → 执行中(呼吸点),未读标题加粗
    expect(html).toContain('执行中')
    expect(html).not.toContain('运行中')
    expect(html).toContain('等待验证')
    expect(html).toContain('breathe')
    expect(html).toContain('font-weight:600')
    expect(html).toContain('data-pin-id="session-1"')
    expect(html).toContain('aria-label="取消置顶"')
    // 上下箭头/置顶按钮列已移除,排序改长按拖拽、取消置顶改左滑
    expect(html).not.toContain('aria-label="上移"')
    expect(html).not.toContain('aria-label="下移"')
  })

  test('groupPinnedItems merges by agent+project and keeps first-occurrence order', () => {
    // 同 Agent+项目归并为一组,保持全局 sortOrder 顺序;不同组按首项出现序排列
    const sameAgent = { ...item, sessionId: 'session-3', sessionTitle: '同组会话', sortOrder: 2 }
    const otherAgent = {
      ...item,
      sessionId: 'session-2',
      agentId: 'agent-2',
      agentName: '测试智能体',
      projectId: 'project-2',
      projectName: '其他项目',
      activityState: 'idle' as const,
      unread: false,
      sortOrder: 3,
    }
    const groups = groupPinnedItems([item, otherAgent, sameAgent])

    expect(groups).toHaveLength(2)
    expect(groups[0]!.key).toBe('agent-1:project-1')
    expect(groups[0]!.agentName).toBe('编码智能体')
    expect(groups[0]!.sessions.map((session) => session.sessionId)).toEqual(['session-1', 'session-3'])
    expect(groups[1]!.key).toBe('agent-2:project-2')
    expect(groups[1]!.sessions).toHaveLength(1)
  })

  test('renders grouped pinned cards with the activity-style head', () => {
    const otherAgent = {
      ...item,
      sessionId: 'session-2',
      agentId: 'agent-2',
      agentName: '测试智能体',
      projectId: 'project-2',
      projectName: '其他项目',
      activityState: 'idle' as const,
      unread: false,
    }
    const groups = groupPinnedItems([item, otherAgent])
    const rowProps = {
      removing: false,
      dragY: 0,
      dragActive: false,
      liftX: 0,
      liftAnimating: false,
      onOpen: () => undefined,
      onRemove: () => undefined,
    }
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(PinnedGroupCard, { group: groups[0]! },
        createElement(PinnedSessionRow, { item: groups[0]!.sessions[0]!, ...rowProps })),
      createElement(PinnedGroupCard, { group: groups[1]! },
        createElement(PinnedSessionRow, { item: groups[1]!.sessions[0]!, ...rowProps })),
    ))

    // 组头:AgentAvatar + 名称 + N 个会话 + 项目 chip,与动态页同一套 list-kit 基元
    expect(html).toContain('编码智能体')
    expect(html).toContain('测试智能体')
    expect(html).toContain('AI IDE Studio')
    expect(html).toContain('其他项目')
    expect(html).toMatch(/1 个会话/)
    expect(html).toContain('data-agent-id="agent-1"')
    // 已读且空闲的置顶会话显示灰色"空闲"态(动态页没有此态,置顶页补齐)
    expect(html).toContain('空闲')
  })

  test('renders the embedded mobile pinned list loading state without its own page header', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PinnedSessionList)))

    // SSR uses the initial Zustand snapshot; do not report an empty list before the catalog loads.
    expect(html).toContain('正在同步')
    expect(html).not.toContain('还没有置顶会话')
    expect(html).not.toContain('跨项目持续关注')
  })

  test('uses activity, sessions, reading, inspiration, and settings as the mobile tab bar', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(MobileShell)))

    expect(html.indexOf('>动态<')).toBeLessThan(html.indexOf('>会话<'))
    expect(html.indexOf('>会话<')).toBeLessThan(html.indexOf('>阅读<'))
    expect(html.indexOf('>阅读<')).toBeLessThan(html.indexOf('>灵感<'))
    expect(html.indexOf('>灵感<')).toBeLessThan(html.indexOf('>设置<'))
    expect(html).not.toContain('>置顶<')
    expect(html).not.toContain('>秘书<')
  })
})
