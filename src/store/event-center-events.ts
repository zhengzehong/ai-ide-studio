import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface EventEvidenceItem {
  title: string
  url?: string
}

export interface EventCenterEventRow {
  id: string
  project_id: string | null
  category_id: string
  title: string
  summary: string | null
  source_type: string
  source_id: string | null
  source_label: string | null
  priority: string
  confidence: number
  status: string
  tags_json: string
  payload_json: string
  evidence_json: string
  dedupe_key: string | null
  created_by_agent_id: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

/** 列表/分页返回的行(不含 evidence_json,见 LIST_COLUMNS)。 */
export type EventCenterEventListRow = Omit<EventCenterEventRow, 'evidence_json'>

export interface CreateEventCenterEventInput {
  projectId?: string | null
  categoryId: string
  title: string
  summary?: string | null
  sourceType?: string
  sourceId?: string | null
  sourceLabel?: string | null
  priority?: string
  confidence?: number
  status?: string
  tags?: string[]
  payload?: Record<string, unknown>
  evidence?: EventEvidenceItem[]
  dedupeKey?: string | null
  createdByAgentId?: string | null
}

export interface EventListFilter {
  projectId?: string
  categoryId?: string
  status?: string
  keyword?: string
  limit?: number
  offset?: number
}

export interface EventListPage {
  items: EventCenterEventListRow[]
  total: number
  limit: number
  offset: number
}

/**
 * 列表投影:不含 evidence_json(每行均值 2B、事件中心 UI 未使用,详见 P0-2)。
 * payload_json 必须保留 —— 列表 chips(EventTable.tsx)与详情面板(EventDetailPanel.tsx)
 * 都直接读列表项的 payload_json。
 */
const LIST_COLUMNS = `id, project_id, category_id, title, summary, source_type, source_id, source_label,
  priority, confidence, status, tags_json, payload_json, dedupe_key, created_by_agent_id,
  created_at, updated_at, archived_at`

/** 列表默认返回上限;显式传 limit 才可超过(见 list())。 */
export const DEFAULT_EVENT_LIST_LIMIT = 200
/** 即便显式传 limit 也不放行的硬上限:再大就会撞 2MB 的 realtime 帧预算。 */
export const MAX_EVENT_LIST_LIMIT = 1000

export const eventCenterEventStore = {
  create(input: CreateEventCenterEventInput): EventCenterEventRow {
    const now = new Date().toISOString()
    const event: EventCenterEventRow = {
      id: `evt-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId ?? null,
      category_id: input.categoryId,
      title: input.title,
      summary: input.summary ?? null,
      source_type: input.sourceType ?? 'agent',
      source_id: input.sourceId ?? null,
      source_label: input.sourceLabel ?? null,
      priority: input.priority ?? 'medium',
      confidence: input.confidence ?? 0,
      status: input.status ?? 'pending',
      tags_json: JSON.stringify(input.tags ?? []),
      payload_json: JSON.stringify(input.payload ?? {}),
      evidence_json: JSON.stringify(input.evidence ?? []),
      dedupe_key: input.dedupeKey ?? null,
      created_by_agent_id: input.createdByAgentId ?? null,
      created_at: now,
      updated_at: now,
      archived_at: null,
    }

    getDb().prepare(`
      INSERT INTO event_center_events (
        id, project_id, category_id, title, summary, source_type, source_id, source_label,
        priority, confidence, status, tags_json, payload_json, evidence_json, dedupe_key,
        created_by_agent_id, created_at, updated_at, archived_at
      )
      VALUES (
        @id, @project_id, @category_id, @title, @summary, @source_type, @source_id, @source_label,
        @priority, @confidence, @status, @tags_json, @payload_json, @evidence_json, @dedupe_key,
        @created_by_agent_id, @created_at, @updated_at, @archived_at
      )
    `).run(event)
    return event
  },

  get(id: string): EventCenterEventRow | undefined {
    return getDb().prepare<[string], EventCenterEventRow>('SELECT * FROM event_center_events WHERE id = ?').get(id)
  },

  list(filter: EventListFilter = {}): EventCenterEventListRow[] {
    const { where, params } = buildListQuery(filter)
    return getDb()
      .prepare<Record<string, string | number>, EventCenterEventListRow>(`
        SELECT ${LIST_COLUMNS} FROM event_center_events
        ${where}
        ORDER BY created_at DESC, rowid DESC
        LIMIT @limit
      `)
      .all({ ...params, limit: listLimit(filter.limit) })
  },

  listPage(filter: EventListFilter = {}): EventListPage {
    const { where, params } = buildListQuery(filter)
    const limit = clampLimit(filter.limit)
    const offset = clampOffset(filter.offset)
    const total = getDb()
      .prepare<Record<string, string>, { total: number }>(`
        SELECT COUNT(*) AS total FROM event_center_events
        ${where}
      `)
      .get(params)?.total ?? 0
    const items = getDb()
      .prepare<Record<string, string | number>, EventCenterEventListRow>(`
        SELECT ${LIST_COLUMNS} FROM event_center_events
        ${where}
        ORDER BY created_at DESC, rowid DESC
        LIMIT @limit OFFSET @offset
      `)
      .all({ ...params, limit, offset })
    return { items, total, limit, offset }
  },

  updateStatus(id: string, status: string): EventCenterEventRow | undefined {
    const archivedAt = status === 'archived' ? new Date().toISOString() : null
    getDb().prepare(`
      UPDATE event_center_events
      SET status = ?, updated_at = ?, archived_at = COALESCE(?, archived_at)
      WHERE id = ?
    `).run(status, new Date().toISOString(), archivedAt, id)
    return eventCenterEventStore.get(id)
  },
}

function buildListQuery(filter: EventListFilter): { where: string; params: Record<string, string> } {
  const clauses: string[] = []
  const params: Record<string, string> = {}
  if (filter.projectId) {
    clauses.push('project_id = @projectId')
    params.projectId = filter.projectId
  }
  if (filter.categoryId) {
    clauses.push('category_id = @categoryId')
    params.categoryId = filter.categoryId
  }
  if (filter.status) {
    clauses.push('status = @status')
    params.status = filter.status
  }
  if (filter.keyword?.trim()) {
    clauses.push(`(
      title LIKE @keyword
      OR COALESCE(summary, '') LIKE @keyword
      OR COALESCE(source_label, '') LIKE @keyword
      OR tags_json LIKE @keyword
    )`)
    params.keyword = `%${filter.keyword.trim()}%`
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return { where, params }
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30
  return Math.max(1, Math.min(100, Math.floor(value)))
}

/**
 * list() 的上限:不传 → 默认 200(历史上这里完全无 LIMIT,任何不带 limit 的调用方
 * 会拿到全量 —— 实测 7,697 行 / 5.9MB JSON,超 2MB realtime 帧预算被拒)。
 * 显式传 limit 放行,但有硬上限 MAX_EVENT_LIST_LIMIT 兜底。
 */
function listLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_EVENT_LIST_LIMIT
  return Math.max(1, Math.min(MAX_EVENT_LIST_LIMIT, Math.floor(value)))
}

function clampOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}
