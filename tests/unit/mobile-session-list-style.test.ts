import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import SessionGroup from '../../mobile/src/components/SessionGroup'
import { ActivityGroup } from '../../mobile/src/pages/ActivityPage'
import type { MobileSessionItem } from '../../mobile/src/stores/session.store'
import type { MobileActivityGroup } from '../../mobile/src/stores/activity.store'

const SESSION: MobileSessionItem = {
  id: 'session-1',
  agentId: 'agent-1',
  agentName: '编码智能体',
  projectId: 'project-1',
  projectName: 'AI IDE Studio',
  taskId: null,
  sessionTitle: 'APP 改造',
  status: 'active',
  activityState: 'running',
  stage: '正在实现',
  unread: false,
  startedAt: '2026-08-26T08:00:00.000Z',
  updatedAt: null,
  lastMessageAt: '2026-08-26T08:02:00.000Z',
  lastReadAt: null,
  closedAt: null,
}

const ACTIVITY_GROUP: MobileActivityGroup = {
  groupId: 'agent-1:project-1',
  agentId: 'agent-1',
  agentName: '编码智能体',
  agentIcon: null,
  projectId: 'project-1',
  projectName: 'AI IDE Studio',
  activityAt: '2026-08-26T08:02:00.000Z',
  sessions: [{
    sessionId: 'session-1',
    taskId: null,
    taskTitle: null,
    taskStatus: null,
    sessionTitle: 'APP 改造',
    status: 'active',
    stage: '',
    running: true,
    unread: false,
    attentionState: 'running',
    activityAt: '2026-08-26T08:02:00.000Z',
  }],
}

function renderSessionGroup(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SessionGroup, {
    agentId: 'agent-1',
    agentName: '编码智能体',
    sessions: [SESSION],
    onLongPress: () => undefined,
  })))
}

function renderActivityGroup(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ActivityGroup, {
    group: ACTIVITY_GROUP,
    onOpen: () => undefined,
  })))
}

describe('mobile session list style unification', () => {
  test('会话页与动态页分组共用轻分组卡片样式', () => {
    const sessionHtml = renderSessionGroup()
    const activityHtml = renderActivityGroup()

    expect(sessionHtml).toContain('group-block')
    expect(activityHtml).toContain('group-block')
  })

  test('同一 agentId 在两页取到同一渐变头像', () => {
    const sessionHtml = renderSessionGroup()
    const activityHtml = renderActivityGroup()

    const sessionAvatar = /linear-gradient\(135deg, ([^)]+)\)/.exec(sessionHtml)?.[1]
    const activityAvatar = /linear-gradient\(135deg, ([^)]+)\)/.exec(activityHtml)?.[1]

    expect(sessionAvatar).toBeTruthy()
    expect(activityAvatar).toBe(sessionAvatar)
  })

  test('会话行动态行共用状态词与状态点结构', () => {
    const sessionHtml = renderSessionGroup()
    const activityHtml = renderActivityGroup()

    expect(sessionHtml).toContain('执行中')
    expect(activityHtml).toContain('执行中')
    expect(sessionHtml).toContain('breathe')
    expect(activityHtml).toContain('breathe')
  })
})
