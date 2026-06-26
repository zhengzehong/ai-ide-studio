import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const projectMetaMigration: Migration = {
  version: '026',
  name: 'project_meta',
  up(db) {
    safeAdd(db, 'projects', 'color', 'TEXT')
    safeAdd(db, 'projects', 'icon', 'TEXT')
    safeAdd(db, 'projects', 'last_visited_at', 'TEXT')
    safeAdd(db, 'projects', 'visit_count', 'INTEGER NOT NULL DEFAULT 0')
  },
}
