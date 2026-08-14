import type { Migration } from '../migrator.js'

export const projectSecretaryMigration: Migration = {
  version: '051',
  name: 'project-secretary',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_secretaries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        definition_prompt TEXT NOT NULL DEFAULT '',
        report_prompt TEXT NOT NULL DEFAULT '',
        execution_agent_id TEXT NOT NULL,
        runtime_session_id TEXT,
        chat_session_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        observe_all INTEGER NOT NULL DEFAULT 0,
        last_run_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (execution_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (runtime_session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (chat_session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_project_secretaries_project
        ON project_secretaries(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS project_secretary_observers (
        secretary_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        PRIMARY KEY (secretary_id, agent_id),
        FOREIGN KEY (secretary_id) REFERENCES project_secretaries(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_secretary_triggers (
        id TEXT PRIMARY KEY,
        secretary_id TEXT NOT NULL,
        type TEXT NOT NULL,
        cron TEXT,
        event_type TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (secretary_id) REFERENCES project_secretaries(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_secretary_triggers_secretary
        ON project_secretary_triggers(secretary_id, enabled);

      CREATE TABLE IF NOT EXISTS project_secretary_runs (
        id TEXT PRIMARY KEY,
        secretary_id TEXT NOT NULL,
        trigger_id TEXT,
        event_type TEXT NOT NULL,
        source_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        dedupe_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        FOREIGN KEY (secretary_id) REFERENCES project_secretaries(id) ON DELETE CASCADE,
        FOREIGN KEY (trigger_id) REFERENCES project_secretary_triggers(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_secretary_runs_pending
        ON project_secretary_runs(secretary_id, status, created_at);

      CREATE TABLE IF NOT EXISTS secretary_threads (
        id TEXT PRIMARY KEY,
        secretary_id TEXT NOT NULL,
        thread_key TEXT NOT NULL,
        subject TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'result',
        priority TEXT NOT NULL DEFAULT 'normal',
        needs_action INTEGER NOT NULL DEFAULT 0,
        unread INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'open',
        body_markdown TEXT NOT NULL DEFAULT '',
        source_refs_json TEXT NOT NULL DEFAULT '[]',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (secretary_id) REFERENCES project_secretaries(id) ON DELETE CASCADE,
        UNIQUE (secretary_id, thread_key)
      );

      CREATE INDEX IF NOT EXISTS idx_secretary_threads_mailbox
        ON secretary_threads(secretary_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS secretary_entries (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES secretary_threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_secretary_entries_thread
        ON secretary_entries(thread_id, created_at ASC);
    `)
  },
}
