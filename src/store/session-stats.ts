import { getDb } from './db.js'
import { userVisibleSessionSql } from './session-visibility.js'
import { resolveSessionRuntimeState } from './session-runtime-state.js'
import { listTeamActivity } from './team-activity.js'
import type { TeamActivitySummary } from '../shared/team-activity.js'

export interface ProjectSessionStats {
  projectId: string
  sessionCount: number
  runningCount: number
  unreadCount: number
  teams: TeamActivitySummary[]
}

interface ProjectSessionStatsQueryRow {
  project_id: string
  session_id: string | null
  status: string | null
  stage: string | null
  last_message_at: string | null
  last_read_at: string | null
  has_running_agent_message: number
  has_running_process_item: number
}

export const projectSessionStatsStore = {
  list(isPromptActive: (sessionId: string) => boolean = () => false): ProjectSessionStats[] {
    const rows = getDb().prepare<[], ProjectSessionStatsQueryRow>(`
      SELECT
        p.id AS project_id,
        s.id AS session_id,
        s.status,
        s.stage,
        s.last_message_at,
        s.last_read_at,
        CASE WHEN s.id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM messages m
          WHERE m.session_id = s.id AND m.role = 'agent' AND m.status = 'running'
        ) THEN 1 ELSE 0 END AS has_running_agent_message,
        CASE WHEN s.id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM turn_process_items item
          WHERE item.session_id = s.id AND item.status IN ('running', 'pending', 'in_progress')
        ) THEN 1 ELSE 0 END AS has_running_process_item
      FROM projects p
      LEFT JOIN sessions s
        ON s.project_id = p.id
        AND s.deleted_at IS NULL
        AND s.archived_at IS NULL
        AND s.is_template = 0
        AND ${userVisibleSessionSql()}
        AND s.status = 'active'
        -- Team grids are represented once by their team, not by individual Sessions.
        -- 只排除仍然在线的成员格子（left_at IS NULL）：已退出会话线的成员 session 回归普通池，
        -- 避免"团队网格与普通计数两边都不算"的黑洞（与 team-activity.ts 的 grid 定义保持一致）。
        AND NOT EXISTS (
          SELECT 1
          FROM team_conversation_members tcm
          WHERE tcm.session_id = s.id AND tcm.left_at IS NULL
        )
        AND NOT EXISTS (SELECT 1 FROM team_conversations tc WHERE tc.master_session_id = s.id)
        AND NOT EXISTS (
          SELECT 1
          FROM agents ta
          WHERE ta.id = s.agent_id
            AND json_valid(ta.config_json)
            AND COALESCE(json_extract(ta.config_json, '$.teamInternal'), 0) = 1
        )
      ORDER BY p.created_at ASC, p.id ASC, s.started_at ASC, s.id ASC
    `).all()

    const statsByProject = new Map<string, ProjectSessionStats>()
    for (const row of rows) {
      const stats = statsByProject.get(row.project_id) ?? {
        projectId: row.project_id,
        sessionCount: 0,
        runningCount: 0,
        unreadCount: 0,
        teams: [],
      }
      statsByProject.set(row.project_id, stats)
      if (!row.session_id) continue
      stats.sessionCount += 1

      const runtimeState = resolveSessionRuntimeState({
        promptActive: isPromptActive(row.session_id),
        hasRunningAgentMessage: row.has_running_agent_message === 1,
        hasRunningProcessItem: row.has_running_process_item === 1,
        status: row.status ?? '',
        stage: row.stage,
      })
      if (runtimeState === 'running') {
        stats.runningCount += 1
      } else if (isUnread(row.last_message_at, row.last_read_at)) {
        stats.unreadCount += 1
      }
    }
    for (const team of listTeamActivity(isPromptActive)) {
      const stats = statsByProject.get(team.projectId)
      if (!stats) continue
      stats.teams.push(team)
      // 团队按会话线条数计入（对齐"团队条目按会话算"）：总数含归档线，在跑/未读只算未归档线。
      // ?? 回退保旧行为（纯增字段前的服务端数据/旧调用方）。
      stats.sessionCount += team.total ?? 1
      stats.runningCount += team.runningCount ?? (team.running ? 1 : 0)
      stats.unreadCount += team.unreadCount ?? (team.unread ? 1 : 0)
    }
    return [...statsByProject.values()]
  },
}

function isUnread(lastMessageAt: string | null, lastReadAt: string | null): boolean {
  if (!lastMessageAt || !lastReadAt) return false
  const lastMessageMs = Date.parse(lastMessageAt)
  const lastReadMs = Date.parse(lastReadAt)
  return Number.isFinite(lastMessageMs) && Number.isFinite(lastReadMs) && lastMessageMs > lastReadMs
}
