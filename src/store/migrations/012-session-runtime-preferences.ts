import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const sessionRuntimePreferencesMigration: Migration = {
  version: '012',
  name: 'session-runtime-preferences',
  up(db) {
    safeAdd(db, 'sessions', 'runtime_preferences_json', 'TEXT')
  },
}
