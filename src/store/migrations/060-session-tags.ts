import type { Migration } from '../migrator.js'

export const sessionTagsMigration: Migration = {
  version: '060',
  name: 'session-tags',
  up(db) {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    `)
  },
}
