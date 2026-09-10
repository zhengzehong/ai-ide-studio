import type { Migration } from '../migrator.js'

export const teamContactsMigration: Migration = {
  version: '069', name: 'team_contacts',
  up(db) {
    db.exec(`
      CREATE TABLE team_contacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        source_session_id TEXT NOT NULL REFERENCES sessions(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        conversation_id TEXT NOT NULL REFERENCES team_conversations(id),
        created_at TEXT NOT NULL,
        UNIQUE(source_session_id, team_id)
      );
      CREATE INDEX idx_team_contacts_conversation ON team_contacts(conversation_id);
      CREATE TABLE team_member_session_history (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id),
        member_id TEXT NOT NULL REFERENCES team_members(id),
        conversation_id TEXT REFERENCES team_conversations(id),
        replacement_session_id TEXT NOT NULL REFERENCES sessions(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_team_member_history_member ON team_member_session_history(member_id);
    `)
  },
}
