import type { Migration } from '../migrator.js'

export const agentSessionCommunicationMigration: Migration = {
  version: '016',
  name: 'agent-session-communication',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_session_messages (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        source_agent_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        target_session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        related_info_json TEXT NOT NULL DEFAULT '{}',
        need_reply INTEGER NOT NULL DEFAULT 0,
        reply_satisfied_at TEXT,
        reply_reminder_sent_at TEXT,
        reply_reminder_count INTEGER NOT NULL DEFAULT 0,
        prompt_status TEXT NOT NULL DEFAULT 'queued',
        prompt_error TEXT,
        prompt_completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_session_watches (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        watcher_agent_id TEXT NOT NULL,
        watcher_session_id TEXT NOT NULL,
        watched_agent_id TEXT NOT NULL,
        watched_session_id TEXT NOT NULL,
        related_info_json TEXT NOT NULL DEFAULT '{}',
        once INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        trigger_count INTEGER NOT NULL DEFAULT 0,
        triggered_at TEXT,
        triggered_message_id TEXT,
        triggered_turn_id TEXT,
        last_error TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_session_messages_target_reply
        ON agent_session_messages(target_session_id, need_reply, reply_satisfied_at, reply_reminder_count, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_session_messages_reverse
        ON agent_session_messages(source_session_id, target_session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_session_messages_project_created
        ON agent_session_messages(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_session_watches_watched
        ON agent_session_watches(watched_session_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_session_watches_watcher
        ON agent_session_watches(watcher_session_id, status, created_at);
    `)
  },
}
