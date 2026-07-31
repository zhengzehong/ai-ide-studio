export type WidgetAgentActivityState = 'running' | 'needs_input' | 'idle'

export interface WidgetAgentActivitySource {
  sessionId: string
  agentId: string
  agentName: string
  agentIcon: string | null
  projectId: string | null
  projectName: string | null
  taskId: string | null
  taskTitle: string | null
  taskStatus: string | null
  sessionTitle: string | null
  status: string
  activityState: 'running' | 'idle'
  stage: string
  unread: boolean
  startedAt: string
  updatedAt: string | null
  lastMessageAt: string | null
  completedAt: string | null
  closedAt: string | null
}

export interface WidgetAgentActivityItem extends Omit<WidgetAgentActivitySource, 'activityState'> {
  activityState: WidgetAgentActivityState
  activityAt: string
  unreadCount: number
}

export interface WidgetAgentTaskSummary {
  agentId: string
  taskId: string
  taskTitle: string
  taskStatus: string
  projectId: string | null
  sessionId: string | null
}

const NEEDS_INPUT_TASK_STATUSES = new Set(['needs_input', 'blocked'])

function activityTimestamp(session: WidgetAgentActivitySource): string {
  return session.lastMessageAt
    ?? session.completedAt
    ?? session.updatedAt
    ?? session.startedAt
}

function selectionPriority(session: WidgetAgentActivitySource): number {
  if (session.activityState === 'running') return 3
  if (session.unread) return 1
  return 0
}

function isMoreRelevant(
  candidate: WidgetAgentActivitySource,
  current: WidgetAgentActivitySource,
): boolean {
  const priorityDifference = selectionPriority(candidate) - selectionPriority(current)
  if (priorityDifference !== 0) return priorityDifference > 0
  return Date.parse(activityTimestamp(candidate)) > Date.parse(activityTimestamp(current))
}

function activityState(
  session: WidgetAgentActivitySource,
  task?: WidgetAgentTaskSummary,
): WidgetAgentActivityState {
  if (session.activityState === 'running') return 'running'
  if (task && NEEDS_INPUT_TASK_STATUSES.has(task.taskStatus)) return 'needs_input'
  return 'idle'
}

function hasMeaningfulActivity(session: WidgetAgentActivitySource, hasTodayTask: boolean): boolean {
  return session.activityState === 'running'
    || hasTodayTask
    || Boolean(session.lastMessageAt || session.completedAt)
}

export function buildWidgetAgentActivity(
  sessions: WidgetAgentActivitySource[],
  todayTasks: WidgetAgentTaskSummary[] = [],
  limit = 20,
): WidgetAgentActivityItem[] {
  const taskByAgentId = new Map(todayTasks.map((task) => [task.agentId, task]))
  const grouped = new Map<string, { representative: WidgetAgentActivitySource; unreadCount: number }>()

  for (const session of sessions) {
    if (!hasMeaningfulActivity(session, taskByAgentId.has(session.agentId))) continue
    const current = grouped.get(session.agentId)
    if (!current) {
      grouped.set(session.agentId, {
        representative: session,
        unreadCount: session.unread ? 1 : 0,
      })
      continue
    }
    current.unreadCount += session.unread ? 1 : 0
    if (isMoreRelevant(session, current.representative)) current.representative = session
  }

  return [...grouped.values()]
    .map(({ representative, unreadCount }) => {
      const task = taskByAgentId.get(representative.agentId)
      const taskSession = representative.activityState === 'running' || !task?.sessionId
        ? undefined
        : sessions.find((session) => session.agentId === representative.agentId && session.sessionId === task.sessionId)
      const navigationSession = taskSession ?? representative
      return {
        ...representative,
        sessionId: navigationSession.sessionId,
        projectId: task?.projectId ?? navigationSession.projectId,
        taskId: task?.taskId ?? null,
        taskTitle: task?.taskTitle ?? null,
        taskStatus: task?.taskStatus ?? null,
        unread: navigationSession.unread,
        activityState: activityState(representative, task),
        activityAt: activityTimestamp(representative),
        unreadCount,
      }
    })
    .sort((left, right) => {
      const activityDifference = Date.parse(right.activityAt) - Date.parse(left.activityAt)
      return activityDifference || left.agentId.localeCompare(right.agentId)
    })
    .slice(0, limit)
}
