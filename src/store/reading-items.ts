import { randomUUID } from 'node:crypto'
import { createChildLogger } from '../core/logger.js'
import { getDb } from './db.js'

const log = createChildLogger('store:reading-items')

export type ReadingItemFormat = 'md' | 'html' | 'url'
export type ReadingItemStatus = 'unread' | 'read' | 'archived'

export interface ReadingItemRow {
  id: string
  project_id: string | null
  session_id: string | null
  agent_id: string | null
  title: string
  summary: string
  format: ReadingItemFormat
  mount_path: string | null
  entry_file: string | null
  url: string | null
  status: ReadingItemStatus
  created_at: string
  updated_at: string
  read_at: string | null
  archived_at: string | null
}

export interface CreateReadingItemInput {
  projectId?: string | null
  sessionId: string
  agentId: string
  title: string
  summary?: string
  format: ReadingItemFormat
  mountPath?: string | null
  entryFile?: string | null
  url?: string | null
}

export interface ReadingItemListRow extends ReadingItemRow {
  project_name: string | null
  project_color: string | null
  agent_name: string | null
  agent_icon: string | null
  session_title: string | null
}

export interface ListReadingItemsInput {
  status?: 'active' | 'archived'
  projectId?: string | null
  query?: string
  limit?: number
  offset?: number
}

export interface ReadingProjectCount {
  project_id: string | null
  project_name: string | null
  project_color: string | null
  count: number
}

export const readingItemStore = {
  create(input: CreateReadingItemInput): ReadingItemRow {
    const now = new Date().toISOString()
    const row: ReadingItemRow = {
      id: `read-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId ?? null,
      session_id: input.sessionId,
      agent_id: input.agentId,
      title: input.title,
      summary: input.summary ?? '',
      format: input.format,
      mount_path: input.mountPath ?? null,
      entry_file: input.entryFile ?? null,
      url: input.url ?? null,
      status: 'unread',
      created_at: now,
      updated_at: now,
      read_at: null,
      archived_at: null,
    }
    getDb().prepare(`
      INSERT INTO reading_items (
        id, project_id, session_id, agent_id, title, summary, format,
        mount_path, entry_file, url, status, created_at, updated_at, read_at, archived_at
      ) VALUES (
        @id, @project_id, @session_id, @agent_id, @title, @summary, @format,
        @mount_path, @entry_file, @url, @status, @created_at, @updated_at, @read_at, @archived_at
      )
    `).run(row)
    log.info(
      { readingId: row.id, projectId: row.project_id, sessionId: row.session_id, agentId: row.agent_id, format: row.format },
      '阅读条目已创建',
    )
    return row
  },

  get(id: string): ReadingItemRow | undefined {
    return getDb().prepare<[string], ReadingItemRow>('SELECT * FROM reading_items WHERE id = ?').get(id)
  },

  getDetail(id: string): ReadingItemListRow | undefined {
    return getDb().prepare<[string], ReadingItemListRow>(`${READING_DETAIL_SELECT} WHERE r.id = ?`).get(id)
  },

  list(input: ListReadingItemsInput = {}): ReadingItemListRow[] {
    const conditions = [input.status === 'archived' ? "r.status = 'archived'" : "r.status != 'archived'"]
    const params: unknown[] = []
    if (input.projectId === null) conditions.push('r.project_id IS NULL')
    else if (input.projectId) {
      conditions.push('r.project_id = ?')
      params.push(input.projectId)
    }
    const query = input.query?.trim().toLowerCase()
    if (query) {
      conditions.push(`(
        instr(lower(r.title), ?) > 0
        OR instr(lower(r.summary), ?) > 0
        OR instr(lower(COALESCE(s.title, '')), ?) > 0
      )`)
      params.push(query, query, query)
    }
    const limit = Math.max(1, Math.min(200, input.limit ?? 100))
    const offset = Math.max(0, input.offset ?? 0)
    params.push(limit, offset)
    return getDb().prepare<unknown[], ReadingItemListRow>(`
      ${READING_DETAIL_SELECT}
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ? OFFSET ?
    `).all(...params)
  },

  countUnread(): number {
    return getDb()
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM reading_items WHERE status = 'unread'")
      .get()?.count ?? 0
  },

  countByProject(status: 'active' | 'archived' = 'active'): ReadingProjectCount[] {
    const condition = status === 'archived' ? "status = 'archived'" : "status != 'archived'"
    return getDb().prepare<[], ReadingProjectCount>(`
      SELECT r.project_id, p.name AS project_name, p.color AS project_color, COUNT(*) AS count
      FROM reading_items r
      LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.${condition}
      GROUP BY r.project_id, p.name, p.color
      ORDER BY r.project_id
    `).all()
  },

  updateStatus(id: string, status: 'read' | 'archived'): ReadingItemRow | undefined {
    const existing = readingItemStore.get(id)
    if (!existing) return undefined
    const now = new Date().toISOString()
    const readAt = status === 'read' ? (existing.read_at ?? now) : existing.read_at
    const archivedAt = status === 'archived' ? now : null
    getDb().prepare(`
      UPDATE reading_items
      SET status = ?, updated_at = ?, read_at = ?, archived_at = ?
      WHERE id = ?
    `).run(status, now, readAt, archivedAt, id)
    log.info({ readingId: id, status }, '阅读条目状态已更新')
    return readingItemStore.get(id)
  },
}

const READING_DETAIL_SELECT = `
  SELECT
    r.*,
    p.name AS project_name,
    p.color AS project_color,
    a.name AS agent_name,
    a.icon AS agent_icon,
    s.title AS session_title
  FROM reading_items r
  LEFT JOIN projects p ON p.id = r.project_id
  LEFT JOIN agents a ON a.id = r.agent_id
  LEFT JOIN sessions s ON s.id = r.session_id
`
