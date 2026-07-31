export interface WidgetAgentTodayTask {
  agentId: string
  taskId: string
  taskTitle: string
  taskStatus: string
  projectId: string | null
  sessionId: string | null
  assignedAt: string
}

export interface WidgetAgentTaskCandidateRow {
  agent_id: string
  task_id: string
  task_title: string
  task_status: string
  project_id: string | null
  session_id: string | null
  assigned_at: string
  relation_order: number
}

export function selectLatestWidgetAgentTasks(
  rows: WidgetAgentTaskCandidateRow[],
): WidgetAgentTodayTask[] {
  return selectLatestAgentTasks(rows)
}

export function localDayStartIso(now: Date): string {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

function selectLatestAgentTasks(rows: WidgetAgentTaskCandidateRow[]): WidgetAgentTodayTask[] {
  const byAgentAndTask = new Map<string, WidgetAgentTaskCandidateRow>()
  for (const row of rows) {
    const key = `${row.agent_id}:${row.task_id}`
    const current = byAgentAndTask.get(key)
    if (!current || Date.parse(row.assigned_at) > Date.parse(current.assigned_at)) {
      byAgentAndTask.set(key, { ...row, session_id: row.session_id ?? current?.session_id ?? null })
    } else if (!current.session_id && row.session_id) {
      byAgentAndTask.set(key, { ...current, session_id: row.session_id })
    }
  }

  const byAgent = new Map<string, WidgetAgentTaskCandidateRow>()
  for (const row of byAgentAndTask.values()) {
    const current = byAgent.get(row.agent_id)
    if (!current || isLaterTask(row, current)) byAgent.set(row.agent_id, row)
  }
  return [...byAgent.values()].map((row) => ({
    agentId: row.agent_id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    taskStatus: row.task_status,
    projectId: row.project_id,
    sessionId: row.session_id,
    assignedAt: row.assigned_at,
  }))
}

function isLaterTask(
  candidate: WidgetAgentTaskCandidateRow,
  current: WidgetAgentTaskCandidateRow,
): boolean {
  const difference = Date.parse(candidate.assigned_at) - Date.parse(current.assigned_at)
  return difference > 0
    || (difference === 0 && candidate.relation_order > current.relation_order)
}
