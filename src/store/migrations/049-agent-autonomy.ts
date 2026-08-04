import type { Migration } from '../migrator.js'

export const agentAutonomyMigration: Migration = {
  version: '049',
  name: 'agent-autonomy',
  up(db) {
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(sessions)').all()
    if (!columns.some((column) => column.name === 'purpose')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'conversation'`)
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_autonomy_per_agent
      ON sessions(agent_id)
      WHERE purpose = 'autonomy' AND deleted_at IS NULL AND is_template = 0;

      CREATE TABLE IF NOT EXISTS autonomy_reports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        priority TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_autonomy_reports_project_created
      ON autonomy_reports(project_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_autonomy_reports_agent_created
      ON autonomy_reports(agent_id, created_at DESC);
    `)
  },
}
