import { getDb } from './db.js'
import { resolveSessionRuntimeState } from './session-runtime-state.js'
import type { TeamActivitySummary } from '../shared/team-activity.js'

interface GridRow {
  project_id: string
  team_id: string
  conversation_id: string
  conversation_status: string
  session_id: string
  status: string
  stage: string | null
  last_message_at: string | null
  last_read_at: string | null
  has_running_agent_message: number
  has_running_process_item: number
}

interface TeamLineCountRow {
  team_id: string
  project_id: string
  total: number
}

export function listTeamActivity(isPromptActive: (id: string) => boolean, teamId?: string): TeamActivitySummary[] {
  // 会话线口径：status != 'deleted' 全部纳入网格（含已归档），与团队聊天列表可见线数一致。
  const rows = getDb().prepare<{ teamId: string | null }, GridRow>(`
    SELECT t.project_id, t.id AS team_id, tc.id AS conversation_id, tc.status AS conversation_status, s.id AS session_id,
      s.status, s.stage, s.last_message_at, s.last_read_at,
      EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id AND m.role = 'agent' AND m.status = 'running') AS has_running_agent_message,
      EXISTS (SELECT 1 FROM turn_process_items i WHERE i.session_id = s.id AND i.status IN ('running', 'pending', 'in_progress')) AS has_running_process_item
    FROM teams t
    JOIN team_conversations tc ON tc.team_id = t.id AND tc.status != 'deleted'
    JOIN (
      SELECT conversation_id, session_id FROM team_conversation_members WHERE left_at IS NULL
      UNION SELECT id AS conversation_id, master_session_id AS session_id FROM team_conversations
    ) grids ON grids.conversation_id = tc.id
    JOIN sessions s ON s.id = grids.session_id AND s.project_id = t.project_id
    WHERE t.status = 'active' AND t.archived_at IS NULL AND (@teamId IS NULL OR t.id = @teamId)
      AND s.status = 'active' AND s.archived_at IS NULL AND s.deleted_at IS NULL
    ORDER BY t.id, tc.id, s.id
  `).all({ teamId: teamId ?? null })

  // 线总数单独取表计数：格子 session 全部关闭/归档的线也要计入总数（原 JOIN 会让这类线整行缺失）。
  const lineCounts = getDb().prepare<{ teamId: string | null }, TeamLineCountRow>(`
    SELECT t.id AS team_id, t.project_id, COUNT(tc.id) AS total
    FROM teams t
    LEFT JOIN team_conversations tc ON tc.team_id = t.id AND tc.status != 'deleted'
    WHERE t.status = 'active' AND t.archived_at IS NULL AND (@teamId IS NULL OR t.id = @teamId)
    GROUP BY t.id
  `).all({ teamId: teamId ?? null })

  const teams = new Map<string, TeamActivitySummary>()
  for (const line of lineCounts) {
    teams.set(line.team_id, {
      teamId: line.team_id,
      projectId: line.project_id,
      running: false,
      unread: false,
      conversations: [],
      runningCount: 0,
      unreadCount: 0,
      total: line.total,
    })
  }

  const conversationStatus = new Map<string, string>()
  for (const row of rows) {
    const team = teams.get(row.team_id) ?? {
      teamId: row.team_id,
      projectId: row.project_id,
      running: false,
      unread: false,
      conversations: [],
      runningCount: 0,
      unreadCount: 0,
      total: 0,
    }
    teams.set(row.team_id, team)
    conversationStatus.set(row.conversation_id, row.conversation_status)
    let conversation = team.conversations.find(item => item.conversationId === row.conversation_id)
    if (!conversation) {
      conversation = { conversationId: row.conversation_id, running: false, unread: false, lastMessageAt: null, sessionIds: [] }
      team.conversations.push(conversation)
    }
    conversation.sessionIds.push(row.session_id)
    conversation.running ||= resolveSessionRuntimeState({ promptActive: isPromptActive(row.session_id), status: row.status, stage: row.stage, hasRunningAgentMessage: !!row.has_running_agent_message, hasRunningProcessItem: !!row.has_running_process_item }) === 'running'
    conversation.unread ||= !!row.last_message_at && !!row.last_read_at && Date.parse(row.last_message_at) > Date.parse(row.last_read_at)
    if (row.last_message_at && (!conversation.lastMessageAt || row.last_message_at > conversation.lastMessageAt)) conversation.lastMessageAt = row.last_message_at
  }

  // 三选一计数（团队条目徽标口径）：在跑/未读只统计未归档线——归档线按归档约定不再参与
  // 运行与未读提醒，与 TeamConversationList 的"已归档"显示一致；总数含归档，对齐聊天列表可见线数。
  for (const team of teams.values()) {
    let runningCount = 0
    let unreadCount = 0
    for (const conversation of team.conversations) {
      if (conversationStatus.get(conversation.conversationId) !== 'active') continue
      if (conversation.running) runningCount++
      else if (conversation.unread) unreadCount++
      team.running ||= conversation.running
      team.unread ||= conversation.unread
    }
    team.runningCount = runningCount
    team.unreadCount = unreadCount
    if (team.total === undefined) team.total = team.conversations.length
  }
  return [...teams.values()]
}
