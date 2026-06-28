import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const sessionReadStateMigration: Migration = {
  version: '022',
  name: 'session-read-state',
  up(db) {
    safeAdd(db, 'sessions', 'last_read_at', 'TEXT')
    // Backfill: assume sessions that already exist were read by the user, so the
    // first launch after the upgrade doesn't paint every existing session as unread.
    db.exec(`
      UPDATE sessions
      SET last_read_at = COALESCE(last_message_at, updated_at, started_at)
      WHERE last_read_at IS NULL
    `)
  },
}
