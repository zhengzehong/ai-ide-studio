import type { Migration } from '../migrator.js'

export const addSettingsTableMigration: Migration = {
  version: '031',
  name: 'add-settings-table',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  },
}
