import type { Migration } from '../migrator.js'

export const globalSessionDockMigration: Migration = {
  version: '050',
  name: 'global-session-dock',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS global_session_dock (
        session_id TEXT PRIMARY KEY,
        sort_order INTEGER NOT NULL,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_global_session_dock_sort
        ON global_session_dock(sort_order, added_at DESC);
    `)
  },
}
