import { getDb } from './db.js'
import { resolveSessionRuntimeState } from './session-runtime-state.js'
import type { TeamActivitySummary } from '../shared/team-activity.js'

interface GridRow {
  project_id: string
  team_id: string
  conversation_id: string
  session_id: string
  status: string
  stage: string | null
  last_message_at: string | null
  last_read_at: string | null
  has_running_agent_message: number
  has_running_process_item: number
}

export function listTeamActivity(isPromptActive: (id: string) => boolean, teamId?: string): TeamActivitySummary[] {
  const rows = getDb().prepare<{ teamId: string | null }, GridRow>(`
    SELECT t.project_id, t.id AS team_id, tc.id AS conversation_id, s.id AS session_id,
      s.status, s.stage, s.last_message_at, s.last_read_at,
      EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id AND m.role = 'agent' AND m.status = 'running') AS has_running_agent_message,
      EXISTS (SELECT 1 FROM turn_process_items i WHERE i.session_id = s.id AND i.status IN ('running', 'pending', 'in_progress')) AS has_running_process_item
    FROM teams t
    JOIN team_conversations tc ON tc.team_id = t.id AND tc.status = 'active'
    JOIN (
      SELECT conversation_id, session_id FROM team_conversation_members WHERE left_at IS NULL
      UNION SELECT id AS conversation_id, master_session_id AS session_id FROM team_conversations
    ) grids ON grids.conversation_id = tc.id
    JOIN sessions s ON s.id = grids.session_id AND s.project_id = t.project_id
    WHERE t.status = 'active' AND t.archived_at IS NULL AND (@teamId IS NULL OR t.id = @teamId)
      AND s.status = 'active' AND s.archived_at IS NULL AND s.deleted_at IS NULL
    ORDER BY t.id, tc.id, s.id
  `).all({ teamId: teamId ?? null })
  const teams = new Map<string, TeamActivitySummary>()
  for (const row of rows) {
    const team = teams.get(row.team_id) ?? { teamId: row.team_id, projectId: row.project_id, running: false, unread: false, conversations: [] }
    teams.set(row.team_id, team)
    let conversation = team.conversations.find(item => item.conversationId === row.conversation_id)
    if (!conversation) {
      conversation = { conversationId: row.conversation_id, running: false, unread: false, lastMessageAt: null, sessionIds: [] }
      team.conversations.push(conversation)
    }
    conversation.sessionIds.push(row.session_id)
    conversation.running ||= resolveSessionRuntimeState({ promptActive: isPromptActive(row.session_id), status: row.status, stage: row.stage, hasRunningAgentMessage: !!row.has_running_agent_message, hasRunningProcessItem: !!row.has_running_process_item }) === 'running'
    conversation.unread ||= !!row.last_message_at && !!row.last_read_at && Date.parse(row.last_message_at) > Date.parse(row.last_read_at)
    if (row.last_message_at && (!conversation.lastMessageAt || row.last_message_at > conversation.lastMessageAt)) conversation.lastMessageAt = row.last_message_at
    team.running ||= conversation.running
    team.unread ||= conversation.unread
  }
  return [...teams.values()]
}
