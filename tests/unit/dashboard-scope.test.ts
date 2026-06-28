import { describe, expect, test } from 'vitest'
import { scopeDashboardData } from '../../ui/src/pages/dashboard-scope'
import type { AgentData } from '../../ui/src/stores/agent.store'
import type { SessionData } from '../../ui/src/stores/session.store'
import type { TaskData } from '../../ui/src/stores/task.store'

describe('scopeDashboardData', () => {
  test('keeps dashboard stats and lists inside the selected project', () => {
    const agents = [
      agent('agent-a', 'project-a', 'running'),
      agent('agent-b', 'project-b', 'running'),
      agent('agent-global', null, 'running'),
    ]
    const sessions = [
      session('session-a', 'agent-a', 'project-a', 'active'),
      session('session-b', 'agent-b', 'project-b', 'active'),
      session('session-global', 'agent-global', null, 'active'),
    ]
    const tasks = [
      task('task-a', 'project-a', 'executing'),
      task('task-b', 'project-b', 'completed'),
      task('task-global', null, 'executing'),
    ]

    const scoped = scopeDashboardData({ agents, sessions, tasks, currentProjectId: 'project-a' })

    expect(scoped.agents.map((item) => item.id)).toEqual(['agent-a'])
    expect(scoped.sessions.map((item) => item.id)).toEqual(['session-a'])
    expect(scoped.tasks.map((item) => item.id)).toEqual(['task-a'])
    expect(scoped.runningAgents).toBe(1)
    expect(scoped.activeSessions).toBe(1)
    expect(scoped.inProgressTasks).toBe(1)
    expect(scoped.completedTasks).toBe(0)
  })

  test('keeps all data when no project is selected', () => {
    const scoped = scopeDashboardData({
      agents: [agent('agent-a', 'project-a', 'running')],
      sessions: [session('session-a', 'agent-a', 'project-a', 'active')],
      tasks: [task('task-a', 'project-a', 'completed')],
      currentProjectId: null,
    })

    expect(scoped.runningAgents).toBe(1)
    expect(scoped.activeSessions).toBe(1)
    expect(scoped.completedTasks).toBe(1)
  })
})

function agent(id: string, projectId: string | null, status: string): AgentData {
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

function task(id: string, projectId: string | null, status: string): TaskData {
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
