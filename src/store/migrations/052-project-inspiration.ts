import type { Migration } from '../migrator.js'

export const projectInspirationMigration: Migration = {
  version: '052',
  name: 'project-inspiration',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_inspirations (
        project_id TEXT PRIMARY KEY,
        session_id TEXT UNIQUE,
        organizer_agent_id TEXT,
        organization_prompt TEXT NOT NULL DEFAULT '',
        auto_organize INTEGER NOT NULL DEFAULT 1,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (organizer_agent_id) REFERENCES agents(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS inspiration_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_markdown TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        analysis_revision INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        body_markdown TEXT NOT NULL DEFAULT '',
        questions_json TEXT NOT NULL DEFAULT '[]',
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        organized_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_inspiration_notes_project
        ON inspiration_notes(project_id, updated_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS idx_inspiration_notes_queue
        ON inspiration_notes(project_id, status, updated_at ASC);

      CREATE TABLE IF NOT EXISTS inspiration_candidates (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        analysis_revision INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        title TEXT NOT NULL,
        description_markdown TEXT NOT NULL,
        suggested_agent_id TEXT,
        agent_reason TEXT NOT NULL DEFAULT '',
        dispatch_token TEXT,
        task_id TEXT UNIQUE,
        execution_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES inspiration_notes(id) ON DELETE CASCADE,
        FOREIGN KEY (suggested_agent_id) REFERENCES agents(id) ON DELETE SET NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
        FOREIGN KEY (execution_session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        UNIQUE (note_id, analysis_revision, sort_order)
      );

      CREATE INDEX IF NOT EXISTS idx_inspiration_candidates_note
        ON inspiration_candidates(note_id, analysis_revision, sort_order ASC);
    `)
  },
}
