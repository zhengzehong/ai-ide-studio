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

const NEEDS_INPUT_TASK_STATUSES = new Set(['needs_input', 'blocked'])

function activityTimestamp(session: WidgetAgentActivitySource): string {
  return session.lastMessageAt
    ?? session.completedAt
    ?? session.updatedAt
    ?? session.startedAt
}

function selectionPriority(session: WidgetAgentActivitySource): number {
  if (session.activityState === 'running') return 3
  if (session.taskStatus && NEEDS_INPUT_TASK_STATUSES.has(session.taskStatus)) return 2
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

function activityState(session: WidgetAgentActivitySource): WidgetAgentActivityState {
  if (session.activityState === 'running') return 'running'
  if (session.taskStatus && NEEDS_INPUT_TASK_STATUSES.has(session.taskStatus)) return 'needs_input'
  return 'idle'
}

function hasMeaningfulActivity(session: WidgetAgentActivitySource): boolean {
  return session.activityState === 'running'
    || activityState(session) === 'needs_input'
    || Boolean(session.lastMessageAt || session.completedAt)
}

export function buildWidgetAgentActivity(
  sessions: WidgetAgentActivitySource[],
  limit = 20,
): WidgetAgentActivityItem[] {
  const grouped = new Map<string, { representative: WidgetAgentActivitySource; unreadCount: number }>()

  for (const session of sessions) {
    if (!hasMeaningfulActivity(session)) continue
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
    .map(({ representative, unreadCount }) => ({
      ...representative,
      activityState: activityState(representative),
      activityAt: activityTimestamp(representative),
      unreadCount,
    }))
    .sort((left, right) => {
      const activityDifference = Date.parse(right.activityAt) - Date.parse(left.activityAt)
      return activityDifference || left.agentId.localeCompare(right.agentId)
    })
    .slice(0, limit)
}
