import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const teamMcpToolsMigration: Migration = {
  version: '005',
  name: 'team_mcp_tools',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_teams_project ON teams(project_id, status);

      CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(team_id, agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
      CREATE INDEX IF NOT EXISTS idx_team_members_session ON team_members(session_id);

      CREATE TABLE IF NOT EXISTS team_mailbox (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        from_member_id TEXT,
        to_member_id TEXT,
        task_id TEXT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_team_mailbox_team ON team_mailbox(team_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_team_mailbox_task ON team_mailbox(task_id);

      CREATE TABLE IF NOT EXISTS team_events (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_team_events_team_sequence ON team_events(team_id, sequence);
    `)

    safeAdd(db, 'tasks', 'team_id', 'TEXT')
    safeAdd(db, 'tasks', 'assignee_member_id', 'TEXT')
    safeAdd(db, 'tool_contexts', 'team_id', 'TEXT')
    safeAdd(db, 'tool_contexts', 'team_member_id', 'TEXT')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee_member ON tasks(assignee_member_id);
    `)
  },
}
