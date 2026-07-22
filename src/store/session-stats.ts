import { getDb } from './db.js'
import { resolveSessionRuntimeState } from './session-runtime-state.js'

export interface ProjectSessionStats {
  projectId: string
  sessionCount: number
  runningCount: number
  unreadCount: number
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
        AND s.status = 'active'
      ORDER BY p.created_at ASC, p.id ASC, s.started_at ASC, s.id ASC
    `).all()

    const statsByProject = new Map<string, ProjectSessionStats>()
    for (const row of rows) {
      const stats = statsByProject.get(row.project_id) ?? {
        projectId: row.project_id,
        sessionCount: 0,
        runningCount: 0,
        unreadCount: 0,
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
    return [...statsByProject.values()]
  },
}

function isUnread(lastMessageAt: string | null, lastReadAt: string | null): boolean {
  if (!lastMessageAt || !lastReadAt) return false
  const lastMessageMs = Date.parse(lastMessageAt)
  const lastReadMs = Date.parse(lastReadAt)
  return Number.isFinite(lastMessageMs) && Number.isFinite(lastReadMs) && lastMessageMs > lastReadMs
}
