import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

export type SecretaryRunStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface SecretaryRunRow {
  id: string
  secretary_id: string
  trigger_id: string | null
  event_type: string
  source_id: string | null
  payload_json: string
  dedupe_key: string
  status: SecretaryRunStatus
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface EnqueueSecretaryRunInput {
  secretaryId: string
  triggerId?: string
  eventType: string
  sourceId?: string
  payload?: Record<string, unknown>
  dedupeKey: string
}

export const secretaryRunStore = {
  requeueRunning(): number {
    const result = getDb().prepare(`
      UPDATE project_secretary_runs
      SET status = 'pending', started_at = NULL, finished_at = NULL,
          error = '服务重启后重新排队'
      WHERE status = 'running'
    `).run()
    return result.changes
  },

  enqueue(input: EnqueueSecretaryRunInput): SecretaryRunRow {
    const row: SecretaryRunRow = {
      id: `secretary-run-${randomUUID().slice(0, 8)}`,
      secretary_id: input.secretaryId,
      trigger_id: input.triggerId ?? null,
      event_type: input.eventType,
      source_id: input.sourceId ?? null,
      payload_json: JSON.stringify(input.payload ?? {}),
      dedupe_key: input.dedupeKey,
      status: 'pending',
      error: null,
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
    }
    getDb().prepare(`
      INSERT OR IGNORE INTO project_secretary_runs (
        id, secretary_id, trigger_id, event_type, source_id, payload_json,
        dedupe_key, status, error, created_at, started_at, finished_at
      ) VALUES (
        @id, @secretary_id, @trigger_id, @event_type, @source_id, @payload_json,
        @dedupe_key, @status, @error, @created_at, @started_at, @finished_at
      )
    `).run(row)
    return getDb().prepare<[string], SecretaryRunRow>(
      'SELECT * FROM project_secretary_runs WHERE dedupe_key = ?',
    ).get(input.dedupeKey) ?? row
  },

  claimNext(secretaryId: string): SecretaryRunRow | undefined {
    const db = getDb()
    const claim = db.transaction(() => {
      const row = db.prepare<[string], SecretaryRunRow>(`
        SELECT * FROM project_secretary_runs
        WHERE secretary_id = ? AND status = 'pending'
        ORDER BY created_at ASC, id ASC LIMIT 1
      `).get(secretaryId)
      if (!row) return undefined
      db.prepare(`
        UPDATE project_secretary_runs
        SET status = 'running', started_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(new Date().toISOString(), row.id)
      return db.prepare<[string], SecretaryRunRow>('SELECT * FROM project_secretary_runs WHERE id = ?').get(row.id)
    })
    return claim()
  },

  list(secretaryId: string): SecretaryRunRow[] {
    return getDb().prepare<[string], SecretaryRunRow>(
      'SELECT * FROM project_secretary_runs WHERE secretary_id = ? ORDER BY created_at ASC, id ASC',
    ).all(secretaryId)
  },

  listRecent(secretaryId: string, limit: number): SecretaryRunRow[] {
    return getDb().prepare<[string, number], SecretaryRunRow>(`
      SELECT * FROM project_secretary_runs
      WHERE secretary_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(secretaryId, limit)
  },

  finish(id: string, status: Exclude<SecretaryRunStatus, 'pending' | 'running'>, error?: string): void {
    getDb().prepare(`
      UPDATE project_secretary_runs
      SET status = ?, error = ?, finished_at = ?
      WHERE id = ?
    `).run(status, error ?? null, new Date().toISOString(), id)
  },

  parsePayload(row: SecretaryRunRow): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(row.payload_json)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  },
}
