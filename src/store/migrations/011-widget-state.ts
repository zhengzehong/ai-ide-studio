import type { Migration } from '../migrator.js'

export const widgetStateMigration: Migration = {
  version: '011',
  name: 'widget-state',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS widget_read_state (
        session_id TEXT PRIMARY KEY,
        read_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS widget_preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
  },
}
