import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const scheduleEnhancementMigration: Migration = {
  version: '007',
  name: '007-schedule-enhancement',
  up(db) {
    safeAdd(db, 'rules', 'trigger_type', "TEXT NOT NULL DEFAULT 'cron'")
    safeAdd(db, 'rules', 'last_fail_at', 'TEXT')
    safeAdd(db, 'rules', 'fail_count', 'INTEGER NOT NULL DEFAULT 0')
    safeAdd(db, 'rules', 'max_runs', 'INTEGER')
    safeAdd(db, 'rules', 'created_by', 'TEXT')

    db.exec(`
      CREATE TABLE IF NOT EXISTS rule_executions (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        status TEXT NOT NULL,
        task_id TEXT,
        session_id TEXT,
        error TEXT,
        triggered_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rule_executions_rule ON rule_executions(rule_id, triggered_at DESC)`)

    safeAdd(db, 'tasks', 'rule_id', 'TEXT')
  },
}
