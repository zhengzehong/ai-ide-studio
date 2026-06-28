import type { Migration } from '../migrator.js'

export const globalAssistantMigration: Migration = {
  version: '013',
  name: 'global-assistant',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS global_assistant (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        workspace_dir TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_global_assistant_session
        ON global_assistant(session_id);
    `)
  },
}
