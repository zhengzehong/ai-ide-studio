import type { Migration } from '../migrator.js'

export const sessionSharesMigration: Migration = {
  version: '040',
  name: 'session-shares',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_shares (
        id TEXT PRIMARY KEY,
        share_token TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        owner_agent_id TEXT NOT NULL,
        share_name TEXT NOT NULL,
        agent_intro TEXT NOT NULL,
        permission TEXT NOT NULL DEFAULT 'chat',
        tool_call_visibility TEXT NOT NULL DEFAULT 'collapse',
        expires_at TEXT,
        revoked_at TEXT,
        deleted_at TEXT,
        visit_count INTEGER NOT NULL DEFAULT 0,
        last_visited_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_session_shares_token ON session_shares(share_token);
      CREATE INDEX IF NOT EXISTS idx_session_shares_session ON session_shares(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_shares_owner ON session_shares(owner_agent_id);
    `)

    db.exec(`ALTER TABLE messages ADD COLUMN sender_id TEXT`)
    db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`)
    db.exec(`ALTER TABLE messages ADD COLUMN sender_role TEXT NOT NULL DEFAULT 'user'`)
  },
}
