import type { Migration } from '../migrator.js'

export const agentWatchWakeMigration: Migration = {
  version: '038',
  name: 'agent-watch-wake',
  up(db) {
    db.exec(`ALTER TABLE agent_session_watches ADD COLUMN task_id TEXT`)
    db.exec(`ALTER TABLE agent_session_watches ADD COLUMN watch_kind TEXT NOT NULL DEFAULT 'session'`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_session_watches_task ON agent_session_watches(task_id, status)`)
  },
}
