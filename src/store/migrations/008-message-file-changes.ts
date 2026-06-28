import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const messageFileChangesMigration: Migration = {
  version: '008',
  name: 'message-file-changes',
  up(db) {
    safeAdd(db, 'messages', 'file_changes_json', 'TEXT')
  },
}
