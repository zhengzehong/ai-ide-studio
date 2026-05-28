import type { Migration } from '../migrator.js'

export const initialSchemaMigration: Migration = {
  version: '001',
  name: 'initial_schema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        runtime TEXT NOT NULL,
        status TEXT NOT NULL,
        permission_level INTEGER NOT NULL,
        config_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        task_id TEXT,
        acp_session_id TEXT,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        started_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        thinking TEXT,
        tool_calls_json TEXT,
        decision_json TEXT,
        attachments_json TEXT,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp ON messages(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        acp_session_id TEXT,
        message_id TEXT,
        type TEXT NOT NULL,
        role TEXT,
        payload_json TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_events_session_sequence ON session_events(session_id, sequence);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        assigned_agent_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_events_task_sequence ON task_events(task_id, sequence);

      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        cron TEXT NOT NULL,
        action TEXT NOT NULL,
        action_config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT,
        run_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  },
}
