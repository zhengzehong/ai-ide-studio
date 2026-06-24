import { describe, expect, test } from 'vitest'
import {
  buildDashboardViewModel,
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

function session(id: string, agentId: string, projectId: string | null, status: string): SessionData {
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
  }
}

function task(id: string, projectId: string | null, status = 'backlog'): TaskData {
  return {
    id,
    title: id,
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
