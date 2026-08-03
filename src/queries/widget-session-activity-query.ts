export type WidgetSessionAttentionState = 'running' | 'needs_input' | 'unread'

export interface WidgetSessionActivitySource {
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

export interface WidgetSessionActivityItem {
  sessionId: string
  taskId: string | null
  taskTitle: string | null
  taskStatus: string | null
  sessionTitle: string | null
  status: string
  stage: string
  running: boolean
  unread: boolean
  needsInput: boolean
  attentionState: WidgetSessionAttentionState
  activityAt: string
}

export interface WidgetAgentProjectActivityGroup {
  groupId: string
  agentId: string
  agentName: string
  agentIcon: string | null
  projectId: string | null
  projectName: string | null
  activityAt: string
  sessions: WidgetSessionActivityItem[]
}

const NEEDS_INPUT_TASK_STATUSES = new Set(['needs_input', 'blocked'])

function activityTimestamp(session: WidgetSessionActivitySource): string {
  return session.lastMessageAt
    ?? session.completedAt
    ?? session.updatedAt
    ?? session.startedAt
}

function attentionState(session: WidgetSessionActivitySource): WidgetSessionAttentionState | null {
  if (session.taskStatus && NEEDS_INPUT_TASK_STATUSES.has(session.taskStatus)) return 'needs_input'
  if (session.activityState === 'running') return 'running'
  if (session.unread) return 'unread'
  return null
}

function attentionPriority(state: WidgetSessionAttentionState): number {
  if (state === 'needs_input') return 3
  if (state === 'running') return 2
  return 1
}

function compareSessions(left: WidgetSessionActivityItem, right: WidgetSessionActivityItem): number {
  const priorityDifference = attentionPriority(right.attentionState) - attentionPriority(left.attentionState)
  if (priorityDifference !== 0) return priorityDifference
  const activityDifference = Date.parse(right.activityAt) - Date.parse(left.activityAt)
  return activityDifference || left.sessionId.localeCompare(right.sessionId)
}

export function buildWidgetSessionActivityGroups(
  sources: WidgetSessionActivitySource[],
  limit = 30,
): WidgetAgentProjectActivityGroup[] {
  const relevant = sources.flatMap((source): Array<{
    source: WidgetSessionActivitySource
    item: WidgetSessionActivityItem
  }> => {
    const state = attentionState(source)
    if (!state) return []
    return [{
      source,
      item: {
        sessionId: source.sessionId,
        taskId: source.taskId,
        taskTitle: source.taskTitle,
        taskStatus: source.taskStatus,
        sessionTitle: source.sessionTitle,
        status: source.status,
        stage: source.stage,
        running: source.activityState === 'running',
        unread: source.unread,
        needsInput: state === 'needs_input',
        attentionState: state,
        activityAt: activityTimestamp(source),
      },
    }]
  })
    .sort((left, right) => compareSessions(left.item, right.item))
    .slice(0, Math.max(0, limit))

  const groups = new Map<string, WidgetAgentProjectActivityGroup>()
  for (const { source, item } of relevant) {
    const groupId = `${source.agentId}:${source.projectId ?? 'unassigned'}`
    const group = groups.get(groupId)
    if (group) {
      group.sessions.push(item)
      continue
    }
    groups.set(groupId, {
      groupId,
      agentId: source.agentId,
      agentName: source.agentName,
      agentIcon: source.agentIcon,
      projectId: source.projectId,
      projectName: source.projectName,
      activityAt: item.activityAt,
      sessions: [item],
    })
  }
  return [...groups.values()]
}
