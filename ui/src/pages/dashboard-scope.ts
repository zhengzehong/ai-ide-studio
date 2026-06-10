import type { AgentData } from '../stores/agent.store'
import type { SessionData } from '../stores/session.store'
import type { TaskData } from '../stores/task.store'

export interface DashboardScopeInput {
  agents: AgentData[]
  sessions: SessionData[]
  tasks: TaskData[]
  currentProjectId: string | null
}

export interface DashboardScopeResult {
  agents: AgentData[]
  sessions: SessionData[]
  tasks: TaskData[]
  activeSessions: number
  runningAgents: number
  inProgressTasks: number
  completedTasks: number
}

export function scopeDashboardData(input: DashboardScopeInput): DashboardScopeResult {
  const agents = filterByProject(input.agents, input.currentProjectId)
  const sessions = filterByProject(input.sessions, input.currentProjectId)
  const tasks = filterByProject(input.tasks, input.currentProjectId)

  return {
    agents,
    sessions,
    tasks,
    activeSessions: sessions.filter((session) => session.status === 'active').length,
    runningAgents: agents.filter((agent) => agent.status === 'running').length,
    inProgressTasks: tasks.filter((task) => task.status === 'executing' || task.status === 'planning').length,
    completedTasks: tasks.filter((task) => task.status === 'completed').length,
  }
}

function filterByProject<T extends { project_id?: string | null }>(items: T[], projectId: string | null): T[] {
  if (!projectId) return items
  return items.filter((item) => item.project_id === projectId)
}
