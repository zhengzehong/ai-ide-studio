import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const workspaceCustomOrderingMigration: Migration = {
  version: '015',
  name: 'workspace-custom-ordering',
  up(db) {
    safeAdd(db, 'agents', 'sort_order', 'INTEGER')
    safeAdd(db, 'sessions', 'sort_order', 'INTEGER')

    db.exec(`
      WITH ordered_agents AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY COALESCE(project_id, '')
          ORDER BY created_at ASC, id ASC
        ) AS order_value
        FROM agents
        WHERE sort_order IS NULL
      )
      UPDATE agents
      SET sort_order = (SELECT order_value FROM ordered_agents WHERE ordered_agents.id = agents.id)
      WHERE sort_order IS NULL;

      WITH ordered_sessions AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY COALESCE(project_id, ''), agent_id
          ORDER BY started_at ASC, id ASC
        ) AS order_value
        FROM sessions
        WHERE sort_order IS NULL
      )
      UPDATE sessions
      SET sort_order = (SELECT order_value FROM ordered_sessions WHERE ordered_sessions.id = sessions.id)
      WHERE sort_order IS NULL;

      CREATE INDEX IF NOT EXISTS idx_agents_project_sort
        ON agents(project_id, sort_order, created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_project_agent_sort
        ON sessions(project_id, agent_id, sort_order, started_at);
    `)
  },
}
