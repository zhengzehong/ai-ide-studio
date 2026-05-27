import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface AgentRow {
  id: string
  type: string
  name: string
  runtime: string
  status: string
  permission_level: number
  config_json: string | null
  created_at: string
}

export interface CreateAgentInput {
  id?: string
  type: string
  name: string
  runtime: string
  permissionLevel?: number
  config?: Record<string, unknown>
}

export const agentStore = {
  create(input: CreateAgentInput): AgentRow {
    const id = input.id || `agent-${randomUUID().slice(0, 8)}`
    const agent: AgentRow = {
      id,
      type: input.type,
      name: input.name,
      runtime: input.runtime,
      status: 'standby',
      permission_level: input.permissionLevel ?? 3,
      config_json: input.config ? JSON.stringify(input.config) : null,
      created_at: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO agents (id, type, name, runtime, status, permission_level, config_json, created_at)
      VALUES (@id, @type, @name, @runtime, @status, @permission_level, @config_json, @created_at)
    `).run(agent)
    return agent
  },

  get(id: string): AgentRow | undefined {
    return getDb().prepare<[string], AgentRow>('SELECT * FROM agents WHERE id = ?').get(id)
  },

  list(): AgentRow[] {
    return getDb().prepare<[], AgentRow>('SELECT * FROM agents ORDER BY created_at ASC').all()
  },

  updateStatus(id: string, status: string): void {
    getDb().prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM agents WHERE id = ?').run(id)
  },

  upsert(input: CreateAgentInput): AgentRow {
    const existing = input.id ? agentStore.get(input.id) : undefined
    if (existing) {
      const updated: AgentRow = {
        ...existing,
        type: input.type,
        name: input.name,
        runtime: input.runtime,
      }
      getDb().prepare(`
        UPDATE agents
        SET type = @type, name = @name, runtime = @runtime
        WHERE id = @id
      `).run(updated)
      return updated
    }
    return agentStore.create(input)
  },
}
