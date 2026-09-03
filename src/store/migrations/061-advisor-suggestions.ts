import type { Migration } from '../migrator.js'

export const advisorSuggestionsMigration: Migration = {
  version: '061',
  name: 'advisor-suggestions',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_advisors (
        project_id TEXT PRIMARY KEY,
        session_id TEXT UNIQUE,
        advisor_agent_id TEXT,
        advisor_prompt TEXT NOT NULL DEFAULT '',
        min_silence_minutes INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (advisor_agent_id) REFERENCES agents(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS advisor_suggestions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        trigger_session_id TEXT,
        sort_order INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'action',
        title TEXT NOT NULL,
        description_markdown TEXT NOT NULL,
        artifact_json TEXT,
        source_evidence_json TEXT NOT NULL DEFAULT '[]',
        suggested_agent_id TEXT,
        agent_reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        dispatch_token TEXT,
        task_id TEXT UNIQUE,
        execution_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expire_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (suggested_agent_id) REFERENCES agents(id) ON DELETE SET NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
        FOREIGN KEY (execution_session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_advisor_suggestions_project
        ON advisor_suggestions(project_id, status, created_at DESC, id DESC);
    `)
  },
}
