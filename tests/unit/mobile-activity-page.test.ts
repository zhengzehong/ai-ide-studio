import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ActivityGroup, syncActivityProject } from '../../mobile/src/pages/ActivityPage'
import { useMobileActivityStore } from '../../mobile/src/stores/activity.store'

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
    expect(html).toContain('运行中')
  })
})
