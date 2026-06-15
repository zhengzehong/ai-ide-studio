import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const agentVisibilityMigration: Migration = {
  version: '018',
  name: 'agent-visibility',
  up(db) {
    safeAdd(db, 'agents', 'hidden_at', 'TEXT')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agents_project_hidden_sort
        ON agents(project_id, hidden_at, sort_order, created_at);
    `)
  },
}
