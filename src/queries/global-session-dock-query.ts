import {
  globalSessionDockStore,
  type GlobalSessionDockSummaryRow,
} from '../store/global-session-dock.js'
import { resolveSessionRuntimeState } from '../store/session-runtime-state.js'
import type { SessionDockItemData } from '../types/ws-protocol.js'

export function listGlobalSessionDockItems(
  isPromptActive: (sessionId: string) => boolean,
): SessionDockItemData[] {
  return mapRows(globalSessionDockStore.listSummaries(), isPromptActive)
}

export function searchGlobalSessionDockCandidates(
  query: string,
  limit: number,
  isPromptActive: (sessionId: string) => boolean,
): SessionDockItemData[] {
  const normalized = query.trim()
  const rows = globalSessionDockStore.searchCandidates(normalized, boundedLimit(limit))
  return mapRows(rows, isPromptActive)
}

function mapRows(
  rows: GlobalSessionDockSummaryRow[],
  isPromptActive: (sessionId: string) => boolean,
): SessionDockItemData[] {
  return rows.map((row) => {
    const completedAt = latestTimestamp(row.latest_agent_message_at, row.latest_done_event_at)
    return {
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      stage: row.stage,
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentIcon: row.agent_icon,
      agentAvatarUrl: row.agent_avatar_url,
      projectId: row.project_id,
      projectName: row.project_name,
      projectColor: row.project_color,
      projectIcon: row.project_icon,
      activityState: resolveSessionRuntimeState({
        promptActive: isPromptActive(row.session_id),
        hasRunningAgentMessage: row.has_running_agent_message === 1,
        hasRunningProcessItem: row.has_running_process_item === 1,
        status: row.status,
        stage: row.stage,
      }),
      unread: Boolean(completedAt && (!row.last_read_at || Date.parse(completedAt) > Date.parse(row.last_read_at))),
      lastActivityAt: row.last_message_at ?? completedAt ?? row.updated_at ?? row.started_at,
      sortOrder: row.sort_order,
      addedAt: row.added_at,
    }
  })
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return Date.parse(left) >= Date.parse(right) ? left : right
}

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 30
  return Math.max(1, Math.min(50, Math.floor(limit)))
}
