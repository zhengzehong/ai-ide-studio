import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface TimelineSummaryRow {
  id: string
  session_id: string
  turns: string
  summary: string
  status: string
  turn_start_at: string
  model_used: string | null
  created_at: string
  updated_at: string
}

export interface TimelineConfigRow {
  project_id: string
  enabled: number
  provider_id: string | null
  model: string | null
  api_key: string | null
  base_url: string | null
  trigger_interval: number
  created_at: string
  updated_at: string
}

export const timelineStore = {
  list(sessionId: string): TimelineSummaryRow[] {
    return getDb()
      .prepare<[string], TimelineSummaryRow>(
        'SELECT * FROM timeline_summaries WHERE session_id = ? ORDER BY turn_start_at ASC',
      )
      .all(sessionId)
  },

  get(id: string): TimelineSummaryRow | undefined {
    return getDb()
      .prepare<[string], TimelineSummaryRow>('SELECT * FROM timeline_summaries WHERE id = ?')
      .get(id)
  },

  countByStatus(sessionId: string, status: string): number {
    const row = getDb()
      .prepare<[string, string], { count: number }>(
        'SELECT COUNT(*) as count FROM timeline_summaries WHERE session_id = ? AND status = ?',
      )
      .get(sessionId, status)
    return row?.count ?? 0
  },

  insertRaw(sessionId: string, turn: number, summary: string, turnStartAt: string): TimelineSummaryRow {
    const now = new Date().toISOString()
    const row: TimelineSummaryRow = {
      id: `tl-${randomUUID().slice(0, 8)}`,
      session_id: sessionId,
      turns: String(turn),
      summary,
      status: 'raw',
      turn_start_at: turnStartAt,
      model_used: null,
      created_at: now,
      updated_at: now,
    }
    getDb()
      .prepare(
        `INSERT INTO timeline_summaries (id, session_id, turns, summary, status, turn_start_at, model_used, created_at, updated_at)
         VALUES (@id, @session_id, @turns, @summary, @status, @turn_start_at, @model_used, @created_at, @updated_at)`,
      )
      .run(row)
    return row
  },

  updateRefined(id: string, summary: string, turns: string, modelUsed: string): void {
    getDb()
      .prepare(
        `UPDATE timeline_summaries SET summary = ?, turns = ?, status = 'refined', model_used = ?, updated_at = ? WHERE id = ?`,
      )
      .run(summary, turns, modelUsed, new Date().toISOString(), id)
  },

  insertRefined(
    sessionId: string,
    summary: string,
    turns: string,
    turnStartAt: string,
    modelUsed: string,
  ): TimelineSummaryRow {
    const now = new Date().toISOString()
    const row: TimelineSummaryRow = {
      id: `tl-${randomUUID().slice(0, 8)}`,
      session_id: sessionId,
      turns,
      summary,
      status: 'refined',
      turn_start_at: turnStartAt,
      model_used: modelUsed,
      created_at: now,
      updated_at: now,
    }
    getDb()
      .prepare(
        `INSERT INTO timeline_summaries (id, session_id, turns, summary, status, turn_start_at, model_used, created_at, updated_at)
         VALUES (@id, @session_id, @turns, @summary, @status, @turn_start_at, @model_used, @created_at, @updated_at)`,
      )
      .run(row)
    return row
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM timeline_summaries WHERE id = ?').run(id)
  },

  deleteBySession(sessionId: string): void {
    getDb().prepare('DELETE FROM timeline_summaries WHERE session_id = ?').run(sessionId)
  },

  deleteRawByTurns(sessionId: string, turns: string[]): void {
    if (turns.length === 0) return
    const placeholders = turns.map(() => '?').join(', ')
    getDb()
      .prepare(`DELETE FROM timeline_summaries WHERE session_id = ? AND status = 'raw' AND turns IN (${placeholders})`)
      .run(sessionId, ...turns)
  },

  listRaw(sessionId: string): TimelineSummaryRow[] {
    return getDb()
      .prepare<[string], TimelineSummaryRow>(
        "SELECT * FROM timeline_summaries WHERE session_id = ? AND status = 'raw' ORDER BY turn_start_at ASC",
      )
      .all(sessionId)
  },

  getRecentRefined(sessionId: string, limit: number): TimelineSummaryRow[] {
    return getDb()
      .prepare<[string, number], TimelineSummaryRow>(
        "SELECT * FROM timeline_summaries WHERE session_id = ? AND status = 'refined' ORDER BY turn_start_at DESC LIMIT ?",
      )
      .all(sessionId, limit)
      .reverse()
  },
}

export const timelineConfigStore = {
  get(projectId: string): TimelineConfigRow | undefined {
    return getDb()
      .prepare<[string], TimelineConfigRow>('SELECT * FROM timeline_config WHERE project_id = ?')
      .get(projectId)
  },

  upsert(projectId: string, fields: Partial<Omit<TimelineConfigRow, 'project_id' | 'created_at' | 'updated_at'>>): TimelineConfigRow {
    const existing = timelineConfigStore.get(projectId)
    const now = new Date().toISOString()
    if (existing) {
      const updated = {
        ...existing,
        enabled: fields.enabled ?? existing.enabled,
        provider_id: fields.provider_id !== undefined ? fields.provider_id : existing.provider_id,
        model: fields.model !== undefined ? fields.model : existing.model,
        api_key: fields.api_key !== undefined ? fields.api_key : existing.api_key,
        base_url: fields.base_url !== undefined ? fields.base_url : existing.base_url,
        trigger_interval: fields.trigger_interval ?? existing.trigger_interval,
        updated_at: now,
      }
      getDb()
        .prepare(
          `UPDATE timeline_config SET enabled=@enabled, provider_id=@provider_id, model=@model, api_key=@api_key,
           base_url=@base_url, trigger_interval=@trigger_interval, updated_at=@updated_at WHERE project_id=@project_id`,
        )
        .run(updated)
      return updated
    }
    const row: TimelineConfigRow = {
      project_id: projectId,
      enabled: fields.enabled ?? 0,
      provider_id: fields.provider_id ?? null,
      model: fields.model ?? null,
      api_key: fields.api_key ?? null,
      base_url: fields.base_url ?? null,
      trigger_interval: fields.trigger_interval ?? 3,
      created_at: now,
      updated_at: now,
    }
    getDb()
      .prepare(
        `INSERT INTO timeline_config (project_id, enabled, provider_id, model, api_key, base_url, trigger_interval, created_at, updated_at)
         VALUES (@project_id, @enabled, @provider_id, @model, @api_key, @base_url, @trigger_interval, @created_at, @updated_at)`,
      )
      .run(row)
    return row
  },
}
