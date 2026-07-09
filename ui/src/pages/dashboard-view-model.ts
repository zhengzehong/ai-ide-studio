import type { AgentData } from '../stores/agent.store'
import type { EventCenterEventData } from '../stores/event-center.store'
import type { ProjectData } from '../stores/project.store'
import type { SessionData } from '../stores/session.store'
import type { TaskData } from '../stores/task.store'

export type DashboardTab = 'agents' | 'tasks' | 'events'
export type DashboardScope = { type: 'all' } | { type: 'project'; projectId: string }
export type AgentDynamicsView = 'agent' | 'project' | 'timeline'
export type AgentDynamicsFilter = 'all' | 'needs_attention' | 'running' | 'idle'
export type SessionBucket = 'needs_attention' | 'running' | 'idle' | 'history'
export type DashboardTaskStatusFilter = 'all' | 'draft' | 'active' | 'needs_attention' | 'done'
export type DashboardEventStatusFilter = 'all' | 'open' | 'running' | 'failed' | 'done'

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
      inProgressTasks: tasks.filter((task) => task.status === 'running' || task.status === 'planning').length,
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

export interface AgentDynamicsRow {
  session: SessionData
  agent: AgentData | null
  project: ProjectData | null
  task: TaskData | null
  title: string
  subtitle: string
  badge: { kind: 'task' | 'activity'; value: string }
  activityState: 'running' | 'idle'
  lastActivityAt: string
  isAbnormal: boolean
  bucket: SessionBucket
}

export interface AgentDynamicsGroup {
  id: string
  title: string
  rows: AgentDynamicsRow[]
}

export interface AgentDynamicsViewModel {
  activeRows: AgentDynamicsRow[]
  historyRows: AgentDynamicsRow[]
  groups: AgentDynamicsGroup[]
}

export interface AgentDynamicsInput {
  agents: AgentData[]
  projects: ProjectData[]
  tasks: TaskData[]
  sessions: SessionData[]
  filter: AgentDynamicsFilter
  view: AgentDynamicsView
  now?: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

export function buildAgentDynamicsViewModel(input: AgentDynamicsInput): AgentDynamicsViewModel {
  const nowMs = input.now?.getTime() ?? Date.now()
  const agentsById = new Map(input.agents.map((agent) => [agent.id, agent]))
  const projectsById = new Map(input.projects.map((project) => [project.id, project]))
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]))
  const rows = input.sessions.map((session) => buildAgentDynamicsRow(session, agentsById, projectsById, tasksById, nowMs))
    .sort(compareAgentRows)
  const visibleRows = rows.filter((row) => matchesAgentFilter(row, input.filter))
  const activeRows = visibleRows.filter((row) => row.bucket !== 'history')
  const historyRows = visibleRows.filter((row) => row.bucket === 'history')

  return {
    activeRows,
    historyRows,
    groups: groupAgentRows(activeRows, input.view),
  }
}

function buildAgentDynamicsRow(
  session: SessionData,
  agentsById: Map<string, AgentData>,
  projectsById: Map<string, ProjectData>,
  tasksById: Map<string, TaskData>,
  nowMs: number,
): AgentDynamicsRow {
  const task = session.task_id ? tasksById.get(session.task_id) ?? null : null
  const activityState = session.activity_state ?? (session.status === 'active' ? 'running' : 'idle')
  const lastActivityAt = coalesceLastActivityAt(session)
  const isAbnormal = activityState === 'idle' && task?.status === 'running'
  const isHistory = activityState === 'idle'
    && !isAbnormal
    && nowMs - new Date(lastActivityAt).getTime() > DAY_MS
  const bucket: SessionBucket = isAbnormal
    ? 'needs_attention'
    : isHistory
      ? 'history'
      : activityState === 'running'
        ? 'running'
        : 'idle'

  return {
    session,
    agent: agentsById.get(session.agent_id) ?? null,
    project: session.project_id ? projectsById.get(session.project_id) ?? null : null,
    task,
    title: task?.title ?? session.title?.trim() ?? '临时对话',
    subtitle: task?.stage || session.stage || activityState,
    badge: task ? { kind: 'task', value: task.status } : { kind: 'activity', value: activityState },
    activityState,
    lastActivityAt,
    isAbnormal,
    bucket,
  }
}

export function coalesceLastActivityAt(session: SessionData): string {
  return session.last_message_at ?? session.updated_at ?? session.started_at
}

function matchesAgentFilter(row: AgentDynamicsRow, filter: AgentDynamicsFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'needs_attention') return row.bucket === 'needs_attention'
  if (filter === 'running') return row.bucket === 'running'
  if (filter === 'idle') return row.bucket === 'idle' || row.bucket === 'history'
  return true
}

function groupAgentRows(rows: AgentDynamicsRow[], view: AgentDynamicsView): AgentDynamicsGroup[] {
  if (view === 'timeline') return [{ id: 'timeline', title: '时间线', rows }]

  const groups = new Map<string, AgentDynamicsGroup>()
  for (const row of rows) {
    const id = view === 'agent' ? row.session.agent_id : row.session.project_id ?? 'global'
    const title = view === 'agent' ? row.agent?.name ?? row.session.agent_id : row.project?.name ?? '未归属项目'
    const group = groups.get(id) ?? { id, title, rows: [] }
    group.rows.push(row)
    groups.set(id, group)
  }
  return [...groups.values()]
}

function compareAgentRows(a: AgentDynamicsRow, b: AgentDynamicsRow): number {
  const bucketDiff = bucketRank(a.bucket) - bucketRank(b.bucket)
  if (bucketDiff !== 0) return bucketDiff
  return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
}

function bucketRank(bucket: SessionBucket): number {
  if (bucket === 'needs_attention') return 0
  if (bucket === 'running') return 1
  if (bucket === 'idle') return 2
  return 3
}

export function filterDashboardTasks(
  tasks: TaskData[],
  filter: { status: DashboardTaskStatusFilter; projectId: string | 'all' },
): TaskData[] {
  return tasks.filter((task) => {
    const projectMatches = filter.projectId === 'all' || task.project_id === filter.projectId
    if (!projectMatches) return false
    if (filter.status === 'all') return true
    if (filter.status === 'draft') return task.status === 'draft'
    if (filter.status === 'active') return task.status === 'running' || task.status === 'planning'
    if (filter.status === 'needs_attention') return task.status === 'blocked' || task.status === 'reviewing'
    if (filter.status === 'done') return task.status === 'completed' || task.status === 'cancelled'
    return true
  })
}

export function filterDashboardEvents(
  events: EventCenterEventData[],
  filter: { status: DashboardEventStatusFilter; projectId: string | 'all' },
): EventCenterEventData[] {
  return events.filter((event) => {
    const projectMatches = filter.projectId === 'all' || event.project_id === filter.projectId
    if (!projectMatches) return false
    if (filter.status === 'all') return true
    if (filter.status === 'open') return event.status === 'pending'
    if (filter.status === 'running') return event.status === 'running'
    if (filter.status === 'failed') return event.status === 'failed'
    if (filter.status === 'done') return event.status === 'consumed' || event.status === 'ignored' || event.status === 'task' || event.status === 'archived'
    return true
  })
}

export function chooseQuickDispatchProjectId(input: {
  scope: DashboardScope
  tasks: TaskData[]
  projects: ProjectData[]
}): string | undefined {
  if (input.scope.type === 'project') return input.scope.projectId
  const projectIds = new Set(input.projects.map((project) => project.id))
  const recentTask = [...input.tasks]
    .filter((task) => task.project_id && projectIds.has(task.project_id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  return recentTask?.project_id ?? input.projects[0]?.id
}
