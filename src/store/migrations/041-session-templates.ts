import type { Migration } from '../migrator.js'

export const sessionTemplatesMigration: Migration = {
  version: '041',
  name: 'session-templates',
  up(db) {
    db.exec(`ALTER TABLE sessions ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0`)

    db.exec(`
      CREATE TABLE IF NOT EXISTS session_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        agent_id TEXT NOT NULL,
        project_id TEXT,
        runtime TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        template_session_id TEXT NOT NULL,
        icon TEXT,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (template_session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_templates_agent ON session_templates(agent_id);
      CREATE INDEX IF NOT EXISTS idx_session_templates_project ON session_templates(project_id);
    `)
  },
}
