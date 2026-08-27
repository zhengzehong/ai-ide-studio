import type { WidgetSessionListItem, WidgetSessionListQuery } from '../ports/query-port.js'
import { resolveSessionRuntimeState } from '../store/session-runtime-state.js'
import {
  listWidgetSessionProjectionRows,
  type WidgetSessionProjectionRow,
} from '../store/widget-session-list.js'
import { localDayStartIso } from './widget-agent-today-task-query.js'

export function listWidgetSessionReadModel(
  input: WidgetSessionListQuery,
  fallbackPromptActive: (sessionId: string) => boolean = () => false,
): WidgetSessionListItem[] {
  const rows = listWidgetSessionProjectionRows(input.projectId)
  const activePromptIds = input.activePromptSessionIds
    ? new Set(input.activePromptSessionIds)
    : undefined
  const isPromptActive = activePromptIds
    ? (sessionId: string): boolean => activePromptIds.has(sessionId)
    : fallbackPromptActive
  const dayStart = Date.parse(localDayStartIso(new Date()))

  return rows.map((row) => toWidgetSession(row, isPromptActive(row.session_id), dayStart))
}

function toWidgetSession(
  row: WidgetSessionProjectionRow,
  promptActive: boolean,
  dayStart: number,
): WidgetSessionListItem {
  const completedAt = row.latest_agent_message_at
  const taskIsToday = row.task_created_at ? Date.parse(row.task_created_at) >= dayStart : false
  return {
    sessionId: row.session_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentIcon: row.agent_icon,
    projectId: row.project_id,
    projectName: row.project_name,
    taskId: taskIsToday ? row.task_id : null,
    taskTitle: taskIsToday ? row.task_title : null,
    taskStatus: taskIsToday ? row.task_status : null,
    sessionTitle: row.session_title,
    status: row.session_status,
    activityState: resolveSessionRuntimeState({
      promptActive,
      hasRunningAgentMessage: row.has_running_agent_message === 1,
      hasRunningProcessItem: row.has_running_process_item === 1,
      status: row.session_status,
      stage: row.stage,
    }),
    stage: row.stage,
    unread: isUnread(row.last_message_at, row.last_read_at),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at ?? completedAt,
    completedAt,
    closedAt: row.closed_at,
  }
}

function isUnread(lastMessageAt: string | null, lastReadAt: string | null): boolean {
  if (!lastMessageAt || !lastReadAt) return false
  return Date.parse(lastMessageAt) > Date.parse(lastReadAt)
}
