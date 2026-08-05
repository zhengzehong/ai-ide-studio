import { getDb } from './db.js'

export interface GlobalSessionDockRow {
  session_id: string
  sort_order: number
  added_at: string
  updated_at: string
}

export interface GlobalSessionDockSummaryRow {
  session_id: string
  session_title: string | null
  status: string
  stage: string
  started_at: string
  updated_at: string | null
  last_message_at: string | null
  last_read_at: string | null
  agent_id: string
  agent_name: string
  agent_icon: string
  agent_avatar_url: string | null
  project_id: string
  project_name: string
  project_color: string | null
  project_icon: string | null
  sort_order: number | null
  added_at: string | null
  latest_agent_message_at: string | null
  latest_done_event_at: string | null
  has_running_agent_message: number
  has_running_process_item: number
}

export const globalSessionDockStore = {
  list(): GlobalSessionDockRow[] {
    return getDb()
      .prepare<[], GlobalSessionDockRow>(`
        SELECT * FROM global_session_dock
        ORDER BY sort_order ASC, added_at DESC, session_id ASC
      `)
      .all()
  },

  listSummaries(): GlobalSessionDockSummaryRow[] {
    return getDb().prepare<[], GlobalSessionDockSummaryRow>(`
      ${summarySelect('JOIN global_session_dock d ON d.session_id = s.id')}
      WHERE ${dockableConditions()}
      ORDER BY d.sort_order ASC, d.added_at DESC, s.id ASC
    `).all()
  },

  searchCandidates(query: string, limit: number): GlobalSessionDockSummaryRow[] {
    return getDb().prepare<
      { query: string; pattern: string; limit: number },
      GlobalSessionDockSummaryRow
    >(`
      ${summarySelect('LEFT JOIN global_session_dock d ON d.session_id = s.id')}
      WHERE ${dockableConditions()}
        AND d.session_id IS NULL
        AND (
          @query = ''
          OR LOWER(COALESCE(s.title, '')) LIKE @pattern
          OR LOWER(a.name) LIKE @pattern
          OR LOWER(p.name) LIKE @pattern
        )
      ORDER BY COALESCE(s.last_message_at, s.updated_at, s.started_at) DESC, s.id ASC
      LIMIT @limit
    `).all({
      query,
      pattern: `%${query.toLocaleLowerCase()}%`,
      limit,
    })
  },

  get(sessionId: string): GlobalSessionDockRow | undefined {
    return getDb()
      .prepare<[string], GlobalSessionDockRow>('SELECT * FROM global_session_dock WHERE session_id = ?')
      .get(sessionId)
  },

  add(sessionId: string): GlobalSessionDockRow {
    const existing = globalSessionDockStore.get(sessionId)
    if (existing) return existing
    const first = getDb()
      .prepare<[], { sort_order: number | null }>('SELECT MIN(sort_order) AS sort_order FROM global_session_dock')
      .get()
    const now = new Date().toISOString()
    const row: GlobalSessionDockRow = {
      session_id: sessionId,
      sort_order: (first?.sort_order ?? 1) - 1,
      added_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO global_session_dock (session_id, sort_order, added_at, updated_at)
      VALUES (@session_id, @sort_order, @added_at, @updated_at)
    `).run(row)
    return row
  },

  remove(sessionId: string): boolean {
    return getDb().prepare('DELETE FROM global_session_dock WHERE session_id = ?').run(sessionId).changes > 0
  },

  pruneUndockable(): number {
    return getDb().prepare(`
      DELETE FROM global_session_dock
      WHERE NOT EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = global_session_dock.session_id
          AND s.project_id IS NOT NULL
          AND s.deleted_at IS NULL
          AND s.archived_at IS NULL
          AND s.is_template = 0
          AND s.purpose = 'conversation'
      )
    `).run().changes
  },

  reorder(sessionIds: string[]): GlobalSessionDockRow[] {
    const uniqueIds = [...new Set(sessionIds.filter(Boolean))]
    const current = globalSessionDockStore.list()
    if (uniqueIds.length !== sessionIds.length || uniqueIds.length !== current.length) {
      throw new Error('会话坞排序必须包含全部且不重复的会话')
    }
    const currentIds = new Set(current.map((row) => row.session_id))
    if (uniqueIds.some((sessionId) => !currentIds.has(sessionId))) {
      throw new Error('会话坞排序包含未知会话')
    }
    const now = new Date().toISOString()
    const update = getDb().prepare(`
      UPDATE global_session_dock
      SET sort_order = ?, updated_at = ?
      WHERE session_id = ?
    `)
    getDb().transaction(() => {
      uniqueIds.forEach((sessionId, index) => update.run(index + 1, now, sessionId))
    })()
    return globalSessionDockStore.list()
  },
}

function summarySelect(dockJoin: string): string {
  return `
    SELECT
      s.id AS session_id,
      s.title AS session_title,
      s.status,
      s.stage,
      s.started_at,
      s.updated_at,
      s.last_message_at,
      s.last_read_at,
      a.id AS agent_id,
      a.name AS agent_name,
      a.icon AS agent_icon,
      a.avatar_url AS agent_avatar_url,
      p.id AS project_id,
      p.name AS project_name,
      p.color AS project_color,
      p.icon AS project_icon,
      d.sort_order,
      d.added_at,
      (
        SELECT MAX(m.timestamp)
        FROM messages m
        WHERE m.session_id = s.id AND m.role = 'agent' AND m.status != 'running'
      ) AS latest_agent_message_at,
      (
        SELECT MAX(e.created_at)
        FROM session_events e
        WHERE e.session_id = s.id AND e.type = 'message.done'
      ) AS latest_done_event_at,
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
    FROM sessions s
    ${dockJoin}
    JOIN agents a ON a.id = s.agent_id
    JOIN projects p ON p.id = s.project_id
  `
}

function dockableConditions(): string {
  return `
    s.project_id IS NOT NULL
    AND s.deleted_at IS NULL
    AND s.archived_at IS NULL
    AND s.is_template = 0
    AND s.purpose = 'conversation'
  `
}
