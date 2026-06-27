import type { Migration } from '../migrator.js'

export const sessionPrimaryMigration: Migration = {
  version: '027',
  name: 'session-primary',
  up(db) {
    try {
      db.exec(`ALTER TABLE sessions ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0`)
    } catch {
      // column already exists
    }
  },
}
