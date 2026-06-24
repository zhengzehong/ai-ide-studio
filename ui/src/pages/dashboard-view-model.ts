import type { AgentData } from '../stores/agent.store'
import type { EventCenterEventData } from '../stores/event-center.store'
import type { ProjectData } from '../stores/project.store'
import type { SessionData } from '../stores/session.store'
import type { TaskData } from '../stores/task.store'

export type DashboardTab = 'agents' | 'tasks' | 'events'
export type DashboardScope = { type: 'all' } | { type: 'project'; projectId: string }

export interface DashboardStats {
  activeSessions: number
  runningAgents: number
  inProgressTasks: number
  completedTasks: number
}

export interface DashboardViewModel {
  agents: AgentData[]
  sessions: SessionData[]
  tasks: TaskData[]
  events: EventCenterEventData[]
  projects: ProjectData[]
  stats: DashboardStats
}

export interface DashboardViewModelInput {
  agents: AgentData[]
  sessions: SessionData[]
  tasks: TaskData[]
  events?: EventCenterEventData[]
  projects: ProjectData[]
  scope: DashboardScope
}

export function buildDashboardViewModel(input: DashboardViewModelInput): DashboardViewModel {
  const agents = filterByDashboardScope(input.agents, input.scope)
  const sessions = filterByDashboardScope(input.sessions, input.scope)
  const tasks = filterByDashboardScope(input.tasks, input.scope)
  const events = filterByDashboardScope(input.events ?? [], input.scope)

  return {
    agents,
    sessions,
    tasks,
    events,
    projects: input.projects,
    stats: {
      activeSessions: sessions.filter((session) => session.status === 'active').length,
      runningAgents: agents.filter((agent) => agent.status === 'running').length,
      inProgressTasks: tasks.filter((task) => task.status === 'executing' || task.status === 'planning').length,
      completedTasks: tasks.filter((task) => task.status === 'completed').length,
    },
  }
}

export function filterByDashboardScope<T extends { project_id?: string | null }>(items: T[], scope: DashboardScope): T[] {
  if (scope.type === 'all') return items
  return items.filter((item) => item.project_id === scope.projectId)
}

export function dashboardScopeProjectId(scope: DashboardScope): string | undefined {
  return scope.type === 'project' ? scope.projectId : undefined
}
