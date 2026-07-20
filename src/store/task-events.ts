import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface TaskEventRow {
  id: string
  task_id: string
  type: string
  payload_json: string
  sequence: number
  created_at: string
}

export interface AppendTaskEventInput {
  type: string
  payload: unknown
}

export const taskEventStore = {
  append(taskId: string, input: AppendTaskEventInput): TaskEventRow {
    const db = getDb()
    const last = db
      .prepare<
        [string],
        { sequence: number }
      >('SELECT sequence FROM task_events WHERE task_id = ? ORDER BY sequence DESC LIMIT 1')
      .get(taskId)
    const ev: TaskEventRow = {
      id: `tevt-${randomUUID().slice(0, 8)}`,
      task_id: taskId,
      type: input.type,
      payload_json: JSON.stringify(input.payload),
      sequence: (last?.sequence ?? 0) + 1,
      created_at: new Date().toISOString(),
    }
    db.prepare(
      `
      INSERT INTO task_events (id, task_id, type, payload_json, sequence, created_at)
      VALUES (@id, @task_id, @type, @payload_json, @sequence, @created_at)
    `,
    ).run(ev)
    return ev
  },

  list(taskId: string, opts?: { limit?: number; afterSequence?: number }): TaskEventRow[] {
    const limit = opts?.limit || 500
    if (opts?.afterSequence != null) {
      return getDb()
        .prepare<{ taskId: string; afterSequence: number; limit: number }, TaskEventRow>(
          `
        SELECT * FROM task_events
        WHERE task_id = @taskId AND sequence > @afterSequence
        ORDER BY sequence DESC
        LIMIT @limit
      `,
        )
        .all({ taskId, afterSequence: opts.afterSequence, limit })
        .reverse()
    }
    return getDb()
      .prepare<{ taskId: string; limit: number }, TaskEventRow>(
        `
      SELECT * FROM task_events
      WHERE task_id = @taskId
      ORDER BY sequence DESC
      LIMIT @limit
    `,
      )
      .all({ taskId, limit })
      .reverse()
  },

  getById(eventId: string): TaskEventRow | null {
    return getDb().prepare<[string], TaskEventRow>('SELECT * FROM task_events WHERE id = ?').get(eventId) ?? null
  },

  listLatestByTaskIds(taskIds: string[]): Record<string, TaskEventRow> {
    if (taskIds.length === 0) return {}
    const placeholders = taskIds.map(() => '?').join(',')
    const rows = getDb()
      .prepare<string[], TaskEventRow>(
        `
        SELECT id, task_id, type, payload_json, sequence, created_at FROM (
          SELECT id, task_id, type, payload_json, sequence, created_at,
            ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY sequence DESC) AS rn
          FROM task_events
          WHERE type IN ('milestone', 'input_requested', 'marked_done')
            AND task_id IN (${placeholders})
        )
        WHERE rn = 1
      `,
      )
      .all(...taskIds)
    const map: Record<string, TaskEventRow> = {}
    for (const row of rows) map[row.task_id] = row
    return map
  },
}

export function parseTaskEventPayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const REPORT_PREVIEW_MAX_LENGTH = 50

export function extractReportPreview(raw: string): string | null {
  const payload = parseTaskEventPayload(raw)
  const reportMd = payload.report_md
  if (typeof reportMd !== 'string' || !reportMd) return null
  const firstLine = reportMd.split('\n')[0]?.trim() ?? ''
  if (!firstLine) return null
  return firstLine.slice(0, REPORT_PREVIEW_MAX_LENGTH)
}
