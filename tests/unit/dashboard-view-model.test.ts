import { describe, expect, test } from 'vitest'
import {
  buildDashboardViewModel,
  buildAgentDynamicsViewModel,
  filterByDashboardScope,
  type DashboardScope,
} from '../../ui/src/pages/dashboard-view-model'
import type { AgentData } from '../../ui/src/stores/agent.store'
import type { ProjectData } from '../../ui/src/stores/project.store'
import type { SessionData } from '../../ui/src/stores/session.store'
import type { TaskData } from '../../ui/src/stores/task.store'

describe('dashboard-view-model', () => {
  test('defaults to all scope and aggregates cross-project rows', () => {
    const model = buildDashboardViewModel({
      agents: [
        agent('agent-a', 'project-a', 'running'),
        agent('agent-b', 'project-b', 'standby'),
      ],
      sessions: [
        session('session-a', 'agent-a', 'project-a', 'active'),
        session('session-b', 'agent-b', 'project-b', 'active'),
      ],
      tasks: [
        task('task-a', 'project-a', 'executing'),
        task('task-b', 'project-b', 'completed'),
      ],
      projects: [project('project-a'), project('project-b')],
      scope: { type: 'all' },
    })

    expect(model.agents.map((item) => item.id)).toEqual(['agent-a', 'agent-b'])
    expect(model.sessions.map((item) => item.id)).toEqual(['session-a', 'session-b'])
    expect(model.tasks.map((item) => item.id)).toEqual(['task-a', 'task-b'])
    expect(model.stats).toEqual({
      activeSessions: 2,
      runningAgents: 1,
      inProgressTasks: 1,
      completedTasks: 1,
    })
  })

  test('filters only dashboard data when a page-local project scope is selected', () => {
    const scope: DashboardScope = { type: 'project', projectId: 'project-a' }

    expect(filterByDashboardScope([agent('agent-a', 'project-a'), agent('agent-b', 'project-b')], scope).map((item) => item.id)).toEqual(['agent-a'])
    expect(filterByDashboardScope([session('session-a', 'agent-a', 'project-a'), session('session-b', 'agent-b', 'project-b')], scope).map((item) => item.id)).toEqual(['session-a'])
    expect(filterByDashboardScope([task('task-a', 'project-a'), task('task-b', 'project-b')], scope).map((item) => item.id)).toEqual(['task-a'])
  })

  test('keeps shell-safe empty arrays and zero stats while data is loading', () => {
    const model = buildDashboardViewModel({
      agents: [],
      sessions: [],
      tasks: [],
      projects: [],
      scope: { type: 'all' },
    })

    expect(model.agents).toEqual([])
    expect(model.sessions).toEqual([])
    expect(model.tasks).toEqual([])
    expect(model.projects).toEqual([])
    expect(model.stats.activeSessions).toBe(0)
  })
})

describe('buildAgentDynamicsViewModel', () => {
  const now = new Date('2026-06-24T12:00:00.000Z')

  test('renders task-backed sessions with task status and pure chats with activity state', () => {
    const model = buildAgentDynamicsViewModel({
      agents: [agent('agent-a', 'project-a')],
      projects: [project('project-a')],
      tasks: [task('task-a', 'project-a', 'executing', '实现登录')],
      sessions: [
        session('session-task', 'agent-a', 'project-a', 'active', { task_id: 'task-a', activity_state: 'running', stage: '写代码', updated_at: '2026-06-24T11:00:00.000Z' }),
        session('session-chat', 'agent-a', 'project-a', 'active', { activity_state: 'idle', title: '方案讨论', stage: '等待输入', updated_at: '2026-06-24T11:00:00.000Z' }),
      ],
      filter: 'all',
      view: 'agent',
      now,
    })

    expect(model.activeRows.map((row) => ({ id: row.session.id, title: row.title, badge: row.badge }))).toEqual([
      { id: 'session-task', title: '实现登录', badge: { kind: 'task', value: 'executing' } },
      { id: 'session-chat', title: '方案讨论', badge: { kind: 'activity', value: 'idle' } },
    ])
  })

  test('marks idle session with executing task as abnormal and need-handling', () => {
    const model = buildAgentDynamicsViewModel({
      agents: [agent('agent-a', 'project-a')],
      projects: [project('project-a')],
      tasks: [task('task-a', 'project-a', 'executing')],
      sessions: [
        session('session-a', 'agent-a', 'project-a', 'active', { task_id: 'task-a', activity_state: 'idle', updated_at: '2026-06-24T11:00:00.000Z' }),
      ],
      filter: 'needs_attention',
      view: 'timeline',
      now,
    })

    expect(model.activeRows).toHaveLength(1)
    expect(model.activeRows[0].isAbnormal).toBe(true)
    expect(model.activeRows[0].bucket).toBe('needs_attention')
  })

  test('folds only non-abnormal idle sessions older than 24h by last activity coalesce', () => {
    const model = buildAgentDynamicsViewModel({
      agents: [agent('agent-a', 'project-a')],
      projects: [project('project-a')],
      tasks: [task('task-a', 'project-a', 'executing')],
      sessions: [
        session('history', 'agent-a', 'project-a', 'active', {
          activity_state: 'idle',
          last_message_at: null,
          updated_at: '2026-06-23T10:00:00.000Z',
          started_at: '2026-06-22T10:00:00.000Z',
        }),
        session('abnormal-old', 'agent-a', 'project-a', 'active', {
          task_id: 'task-a',
          activity_state: 'idle',
          last_message_at: null,
          updated_at: '2026-06-23T10:00:00.000Z',
          started_at: '2026-06-22T10:00:00.000Z',
        }),
      ],
      filter: 'all',
      view: 'agent',
      now,
    })

    expect(model.historyRows.map((row) => row.session.id)).toEqual(['history'])
    expect(model.activeRows.map((row) => row.session.id)).toEqual(['abnormal-old'])
  })

  test('groups the same sessions by agent, project, and timeline', () => {
    const input = {
      agents: [agent('agent-a', 'project-a'), agent('agent-b', 'project-b')],
      projects: [project('project-a'), project('project-b')],
      tasks: [],
      sessions: [
        session('session-a', 'agent-a', 'project-a', 'active', { activity_state: 'running', updated_at: '2026-06-24T11:00:00.000Z' }),
        session('session-b', 'agent-b', 'project-b', 'active', { activity_state: 'idle', updated_at: '2026-06-24T11:00:00.000Z' }),
      ],
      filter: 'all' as const,
      now,
    }

    expect(buildAgentDynamicsViewModel({ ...input, view: 'agent' }).groups.map((group) => group.title)).toEqual(['agent-a', 'agent-b'])
    expect(buildAgentDynamicsViewModel({ ...input, view: 'project' }).groups.map((group) => group.title)).toEqual(['project-a', 'project-b'])
    expect(buildAgentDynamicsViewModel({ ...input, view: 'timeline' }).groups).toHaveLength(1)
  })
})

function agent(id: string, projectId: string | null, status = 'standby'): AgentData {
  return {
    id,
    name: id,
    type: 'dev',
    runtime: 'mock',
    status,
    permission_level: 0,
    config_json: null,
    created_at: '2026-06-10T00:00:00.000Z',
    project_id: projectId,
  }
}

function session(id: string, agentId: string, projectId: string | null, status: string, overrides: Partial<SessionData> = {}): SessionData {
  return {
    id,
    agent_id: agentId,
    task_id: null,
    acp_session_id: null,
    status,
    stage: '',
    started_at: '2026-06-10T00:00:00.000Z',
    closed_at: null,
    project_id: projectId,
    ...overrides,
  }
}

function task(id: string, projectId: string | null, status = 'backlog', title = id): TaskData {
  return {
    id,
    title,
    description: null,
    source: 'human',
    status,
    stage: status,
    assigned_agent_id: null,
    created_at: '2026-06-10T00:00:00.000Z',
    completed_at: null,
    project_id: projectId,
  }
}

function project(id: string): ProjectData {
  return {
    id,
    name: id,
    work_dir: `/tmp/${id}`,
    description: null,
    created_at: '2026-06-10T00:00:00.000Z',
    updated_at: '2026-06-10T00:00:00.000Z',
  }
}
