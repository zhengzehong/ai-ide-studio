import type { Migration } from '../migrator.js'

export const teamConversationsMigration: Migration = {
  version: '065',
  name: 'team_conversations',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS team_conversations (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        master_session_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        last_sequence INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
        FOREIGN KEY (master_session_id) REFERENCES sessions(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_team_conversations_team_updated
        ON team_conversations(team_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS team_conversation_members (
        conversation_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        session_id TEXT,
        joined_at TEXT NOT NULL,
        left_at TEXT,
        PRIMARY KEY (conversation_id, member_id),
        FOREIGN KEY (conversation_id) REFERENCES team_conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (member_id) REFERENCES team_members(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS team_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        source TEXT NOT NULL,
        agent_id TEXT,
        member_id TEXT,
        session_id TEXT,
        kind TEXT NOT NULL,
        content_json TEXT NOT NULL,
        source_message_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(conversation_id, sequence),
        UNIQUE(conversation_id, source_message_id),
        FOREIGN KEY (conversation_id) REFERENCES team_conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_team_messages_conversation_sequence
        ON team_messages(conversation_id, sequence);
    `)
  },
}
