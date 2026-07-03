import { getDb } from './db.js'

export interface AgentHubConnectionRow {
  session_id: string
  agent_id: string
  project_id: string | null
  registration_id: string
  hub_url: string
  hub_agent_id: string
  machine_id: string
  connected_at: string
  last_activity_at: string
}

export const agentHubConnectionStore = {
  upsert(row: AgentHubConnectionRow): void {
    getDb().prepare(`
      INSERT INTO agent_hub_connections
        (session_id, agent_id, project_id, registration_id, hub_url, hub_agent_id, machine_id, connected_at, last_activity_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        project_id = excluded.project_id,
        registration_id = excluded.registration_id,
        hub_url = excluded.hub_url,
        hub_agent_id = excluded.hub_agent_id,
        machine_id = excluded.machine_id,
        last_activity_at = excluded.last_activity_at
    `).run(
      row.session_id, row.agent_id, row.project_id, row.registration_id,
      row.hub_url, row.hub_agent_id, row.machine_id,
      row.connected_at, row.last_activity_at,
    )
  },

  updateActivity(sessionId: string, lastActivityAt: string): void {
    getDb().prepare(`UPDATE agent_hub_connections SET last_activity_at = ? WHERE session_id = ?`)
      .run(lastActivityAt, sessionId)
  },

  delete(sessionId: string): void {
    getDb().prepare(`DELETE FROM agent_hub_connections WHERE session_id = ?`).run(sessionId)
  },

  list(): AgentHubConnectionRow[] {
    return getDb().prepare<[], AgentHubConnectionRow>(`SELECT * FROM agent_hub_connections`).all()
  },

  listStale(threshold: string): AgentHubConnectionRow[] {
    return getDb().prepare<[string], AgentHubConnectionRow>(
      `SELECT * FROM agent_hub_connections WHERE last_activity_at < ?`
    ).all(threshold)
  },
}
