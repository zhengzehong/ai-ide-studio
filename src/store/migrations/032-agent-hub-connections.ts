import type { Migration } from '../migrator.js'

export const agentHubConnectionsMigration: Migration = {
  version: '032',
  name: 'agent-hub-connections',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_hub_connections (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        project_id TEXT,
        registration_id TEXT NOT NULL,
        hub_url TEXT NOT NULL,
        hub_agent_id TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        connected_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_hub_connections_last_activity
        ON agent_hub_connections(last_activity_at);
    `)
  },
}
