import { getDb } from './db.js'

export interface WidgetSessionProjectionRow {
  session_id: string
  agent_id: string
  agent_name: string
  agent_icon: string | null
  project_id: string | null
  project_name: string | null
  task_id: string | null
  task_title: string | null
  task_status: string | null
  task_created_at: string | null
  session_title: string | null
  session_status: string
  stage: string
  started_at: string
  closed_at: string | null
  updated_at: string | null
  last_message_at: string | null
  last_read_at: string | null
  latest_agent_message_at: string | null
  has_running_agent_message: number
  has_running_process_item: number
}

export function listWidgetSessionProjectionRows(projectId?: string): WidgetSessionProjectionRow[] {
  return getDb().prepare<
    { project_id: string | null },
    WidgetSessionProjectionRow
  >(`
    WITH session_links AS (
      SELECT
        s.*,
        COALESCE(
          s.task_id,
          (
            SELECT ts.task_id
            FROM task_steps ts
            WHERE ts.session_id = s.id
            ORDER BY ts.updated_at DESC, ts.id DESC
            LIMIT 1
          )
        ) AS linked_task_id
      FROM sessions s
    )
    SELECT
      s.id AS session_id,
      s.agent_id,
      a.name AS agent_name,
      a.icon AS agent_icon,
      s.project_id,
      p.name AS project_name,
      s.linked_task_id AS task_id,
      t.title AS task_title,
      t.status AS task_status,
      t.created_at AS task_created_at,
      s.title AS session_title,
      s.status AS session_status,
      s.stage,
      s.started_at,
      s.closed_at,
      s.updated_at,
      s.last_message_at,
      s.last_read_at,
      (
        SELECT MAX(m.timestamp)
        FROM messages m
        WHERE m.session_id = s.id AND m.role = 'agent' AND m.status != 'running'
      ) AS latest_agent_message_at,
      EXISTS (
        SELECT 1 FROM messages running_message
        WHERE running_message.session_id = s.id
          AND running_message.role = 'agent'
          AND running_message.status = 'running'
      ) AS has_running_agent_message,
      EXISTS (
        SELECT 1 FROM turn_process_items process_item
        WHERE process_item.session_id = s.id
          AND process_item.status IN ('running', 'pending', 'in_progress')
      ) AS has_running_process_item
    FROM session_links s
    JOIN agents a ON a.id = s.agent_id
    LEFT JOIN projects p ON p.id = s.project_id
    LEFT JOIN tasks t ON t.id = s.linked_task_id
    WHERE s.deleted_at IS NULL
      AND s.archived_at IS NULL
      AND s.purpose = 'conversation'
      AND (@project_id IS NULL OR s.project_id = @project_id)
    ORDER BY COALESCE(s.last_message_at, s.updated_at, s.started_at) DESC
  `).all({ project_id: projectId ?? null })
}
