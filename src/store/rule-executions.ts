import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface RuleExecutionRow {
  id: string
  rule_id: string
  status: 'success' | 'failed' | 'skipped'
  task_id: string | null
  session_id: string | null
  error: string | null
  triggered_at: string
  completed_at: string | null
}

export const ruleExecutionStore = {
  create(input: {
    ruleId: string
    status: RuleExecutionRow['status']
    taskId?: string
    sessionId?: string
    error?: string
    triggeredAt: string
  }): RuleExecutionRow {
    const row: RuleExecutionRow = {
      id: `rexec-${randomUUID().slice(0, 8)}`,
      rule_id: input.ruleId,
      status: input.status,
      task_id: input.taskId ?? null,
      session_id: input.sessionId ?? null,
      error: input.error ?? null,
      triggered_at: input.triggeredAt,
      completed_at: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO rule_executions (id, rule_id, status, task_id, session_id, error, triggered_at, completed_at)
      VALUES (@id, @rule_id, @status, @task_id, @session_id, @error, @triggered_at, @completed_at)
    `).run(row)
    return row
  },

  listByRule(ruleId: string, limit = 20): RuleExecutionRow[] {
    return getDb()
      .prepare<[string, number], RuleExecutionRow>(
        'SELECT * FROM rule_executions WHERE rule_id = ? ORDER BY triggered_at DESC LIMIT ?',
      )
      .all(ruleId, limit)
  },

  countByRule(ruleId: string): { success: number; failed: number } {
    const row = getDb()
      .prepare<[string], { s: number; f: number }>(
        `SELECT
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as s,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as f
        FROM rule_executions WHERE rule_id = ?`,
      )
      .get(ruleId)
    return { success: row?.s ?? 0, failed: row?.f ?? 0 }
  },
}
