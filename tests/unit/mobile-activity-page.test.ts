import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ActivityGroup, resolveTeamLineTotal, syncActivityProject, teamGroupSummary } from '../../mobile/src/pages/ActivityPage'
import { ProjectChip } from '../../mobile/src/components/session-list/list-kit'
import { useMobileActivityStore, type MobileActivityGroup } from '../../mobile/src/stores/activity.store'
import type { MobileConversationCatalog } from '../../src/shared/mobile-conversations'
import type { ProjectSessionStatsData } from '../../src/types/ws-protocol'

beforeEach(() => {
  useMobileActivityStore.setState({
    groups: [{
      groupId: 'agent-1:project-1',
      agentId: 'agent-1',
      agentName: '编码智能体',
      agentIcon: null,
      projectId: 'project-1',
      projectName: 'AI IDE Studio',
      activityAt: '2026-08-26T08:02:00.000Z',
      sessions: [{
        sessionId: 'session-running',
        taskId: 'task-1',
        taskTitle: '调整移动端导航',
        taskStatus: 'running',
        sessionTitle: 'APP 改造',
        status: 'active',
        stage: '正在实现',
        running: true,
        unread: false,
        attentionState: 'running',
        activityAt: '2026-08-26T08:02:00.000Z',
      }],
    }],
    loading: false,
    loaded: true,
    error: null,
  })
})

describe('mobile activity page', () => {
  test('loads target-project agents before mapping its sessions', async () => {
    const order: string[] = []
    const setCurrentProject = vi.fn()
    const fetchAgents = vi.fn(async () => { order.push('agents') })
    const fetchSessions = vi.fn(async () => { order.push('sessions') })

    await syncActivityProject('project-2', { setCurrentProject, fetchAgents, fetchSessions })

    expect(setCurrentProject).toHaveBeenCalledWith('project-2')
    expect(fetchAgents).toHaveBeenCalledWith('project-2')
    expect(fetchSessions).toHaveBeenCalledWith('project-2')
    expect(order).toEqual(['agents', 'sessions'])
  })

  test('renders cross-project activity with session and task context', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ActivityGroup, {
      group: useMobileActivityStore.getState().groups[0]!,
      onOpen: () => undefined,
    })))

    expect(html).toContain('编码智能体')
    expect(html).toContain('AI IDE Studio')
    expect(html).toContain('APP 改造')
    expect(html).toContain('调整移动端导航')
    expect(html).toContain('执行中')
  })

  test('marks unread sessions with the purple dot and 有新回复 label', () => {
    useMobileActivityStore.setState({
      groups: [{
        ...useMobileActivityStore.getState().groups[0]!,
        sessions: [{
          sessionId: 'session-unread',
          taskId: null,
          taskTitle: null,
          taskStatus: null,
          sessionTitle: '新回复会话',
          status: 'active',
          stage: '',
          running: false,
          unread: true,
          attentionState: 'unread',
          activityAt: '2026-08-26T08:05:00.000Z',
        }],
      }],
    })

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ActivityGroup, {
      group: useMobileActivityStore.getState().groups[0]!,
      onOpen: () => undefined,
    })))

    expect(html).toContain('有新回复')
    expect(html).not.toContain('执行中')
  })

  test('同名 agent 跨项目时各自分组并显示项目 chip', () => {
    const groups: MobileActivityGroup[] = [
      {
        groupId: 'pm-a:proj-a',
        agentId: 'pm-a',
        agentName: '项目经理',
        agentIcon: null,
        projectId: 'proj-a',
        projectName: '项目甲',
        activityAt: '2026-08-26T08:02:00.000Z',
        sessions: [{
          sessionId: 'session-a',
          taskId: null,
          taskTitle: null,
          taskStatus: null,
          sessionTitle: '甲项目会话',
          status: 'active',
          stage: '',
          running: true,
          unread: false,
          attentionState: 'running',
          activityAt: '2026-08-26T08:02:00.000Z',
        }],
      },
      {
        groupId: 'pm-b:proj-b',
        agentId: 'pm-b',
        agentName: '项目经理',
        agentIcon: null,
        projectId: 'proj-b',
        projectName: '项目乙',
        activityAt: '2026-08-26T08:03:00.000Z',
        sessions: [{
          sessionId: 'session-b',
          taskId: null,
          taskTitle: null,
          taskStatus: null,
          sessionTitle: '乙项目会话',
          status: 'active',
          stage: '',
          running: false,
          unread: true,
          attentionState: 'unread',
          activityAt: '2026-08-26T08:03:00.000Z',
        }],
      },
    ]

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, [
      createElement(ActivityGroup, { key: 'a', group: groups[0]!, onOpen: () => undefined }),
      createElement(ActivityGroup, { key: 'b', group: groups[1]!, onOpen: () => undefined }),
    ]))

    expect(html).toContain('data-agent-id="pm-a"')
    expect(html).toContain('data-agent-id="pm-b"')
    expect(html).toContain('项目甲')
    expect(html).toContain('项目乙')
    expect((html.match(/项目经理/g) ?? []).length).toBe(2)
    expect(html).toContain('甲项目会话')
    expect(html).toContain('乙项目会话')
  })

  test('项目 chip 使用项目色软底并带图标与项目名', () => {
    const html = renderToStaticMarkup(createElement(ProjectChip, {
      name: '项目甲',
      icon: '🅰️',
      color: '#6c5ce7',
    }))

    expect(html).toContain('🅰️')
    expect(html).toContain('项目甲')
    expect(html).toContain('#6c5ce71a')
  })

  test('项目无色值时 chip 回退主题紫并回退项目名', () => {
    const html = renderToStaticMarkup(createElement(ProjectChip, {
      name: '未归属项目',
    }))

    expect(html).toContain('未归属项目')
    expect(html).toContain('var(--primary-bg)')
  })

  test('团队组头显示在跑/未读/全量线数，不再把活跃线数当总数', () => {
    const teamGroup: MobileActivityGroup = {
      groupId: 'team-1',
      teamId: 'team-1',
      agentId: 'team-1',
      agentName: '双人开发团队',
      agentIcon: null,
      projectId: 'project-1',
      projectName: null,
      activityAt: '2026-08-26T08:02:00.000Z',
      sessions: [
        { sessionId: 'session-running', taskId: null, taskTitle: null, taskStatus: null, sessionTitle: '线1', status: 'active', stage: '', running: true, unread: false, attentionState: 'running', activityAt: '2026-08-26T08:02:00.000Z' },
        { sessionId: 'session-unread', taskId: null, taskTitle: null, taskStatus: null, sessionTitle: '线2', status: 'active', stage: '', running: false, unread: true, attentionState: 'unread', activityAt: '2026-08-26T08:01:00.000Z' },
      ],
    }

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ActivityGroup, {
      group: teamGroup,
      onOpen: () => undefined,
      teamTotal: 3,
    })))

    // 组内 sessions 只含活跃线（2 条），全量线数是 3 —— 组头必须体现后者
    expect(html).toContain('运行中 1')
    expect(html).toContain('未读 1')
    expect(html).toContain('共 3 条会话')
    expect(html).not.toContain('共 2 条会话')
  })

  test('普通分组组头仍是活跃会话数，不显示团队计数', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ActivityGroup, {
      group: useMobileActivityStore.getState().groups[0]!,
      onOpen: () => undefined,
      teamTotal: 3,
    })))

    expect(html).toContain('1 个会话')
    expect(html).not.toContain('共 3 条会话')
  })

  test('团队成员组头文案由 teamGroupSummary 生成（普通组不受影响）', () => {
    expect(teamGroupSummary(2, 1, 5)).toBe('运行中 2 · 未读 1 · 共 5 条会话')
    expect(teamGroupSummary(0, 0, 4)).toBe('共 4 条会话')
    expect(teamGroupSummary(1, 0, 1)).toBe('运行中 1 · 共 1 条会话')
  })

  test('团队全量线数优先取服务端统计，缺失时回退移动端目录活跃线', () => {
    const catalog = {
      teams: [{ id: 'team-1', name: '双人开发团队', projectId: 'project-1' }],
      conversations: [
        { id: 'c1', teamId: 'team-1', projectId: 'project-1', masterSessionId: 's1', title: '线1', status: 'active', running: true, unread: false, lastMessageAt: null, createdAt: '', sessionIds: ['s1'] },
        { id: 'c2', teamId: 'team-1', projectId: 'project-1', masterSessionId: 's2', title: '线2', status: 'active', running: false, unread: true, lastMessageAt: null, createdAt: '', sessionIds: ['s2'] },
      ],
      hiddenAgentIds: [],
      hiddenSessionIds: [],
    }
    const stats = {
      projectId: 'project-1',
      sessionCount: 0,
      runningCount: 0,
      unreadCount: 0,
      teams: [{
        teamId: 'team-1', projectId: 'project-1', running: true, unread: true,
        runningCount: 1, unreadCount: 1, total: 5, conversations: [],
      }],
    }

    // 新服务端：直接给线数（含已归档线），移动端目录只看得见 2 条活跃线
    expect(resolveTeamLineTotal('team-1', stats, catalog)).toBe(5)
    // 旧服务端：无计数时回退 conversations 长度（此处 1 条活跃线）
    expect(resolveTeamLineTotal('team-1', { ...stats, teams: [{ teamId: 'team-1', projectId: 'project-1', running: true, unread: false, conversations: [{ conversationId: 'c1', running: true, unread: false, lastMessageAt: null, sessionIds: ['s1'] }] }] }, catalog)).toBe(1)
    // 统计未到达：回退移动端目录活跃线数
    expect(resolveTeamLineTotal('team-1', undefined, catalog)).toBe(2)
    // 非团队分组不参与
    expect(resolveTeamLineTotal(undefined, stats, catalog)).toBeUndefined()
  })
})
