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
}

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

  list(filter: EventListFilter = {}): EventCenterEventRow[] {
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
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return getDb()
      .prepare<Record<string, string>, EventCenterEventRow>(`
        SELECT * FROM event_center_events
        ${where}
        ORDER BY created_at DESC
      `)
      .all(params)
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
