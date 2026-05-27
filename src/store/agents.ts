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
  project_id: string | null
  template_id: string | null
  system_prompt: string
  icon: string
}

export interface CreateAgentInput {
  id?: string
  type: string
  name: string
  runtime: string
  permissionLevel?: number
  config?: Record<string, unknown>
  projectId?: string
  templateId?: string
  systemPrompt?: string
  icon?: string
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
      project_id: input.projectId ?? null,
      template_id: input.templateId ?? null,
      system_prompt: input.systemPrompt ?? '',
      icon: input.icon ?? 'bot',
    }
    getDb().prepare(`
      INSERT INTO agents (id, type, name, runtime, status, permission_level, config_json, created_at, project_id, template_id, system_prompt, icon)
      VALUES (@id, @type, @name, @runtime, @status, @permission_level, @config_json, @created_at, @project_id, @template_id, @system_prompt, @icon)
    `).run(agent)
    return agent
  },

  get(id: string): AgentRow | undefined {
    return getDb().prepare<[string], AgentRow>('SELECT * FROM agents WHERE id = ?').get(id)
  },

  list(projectId?: string): AgentRow[] {
    if (projectId) {
      return getDb().prepare<[string], AgentRow>('SELECT * FROM agents WHERE project_id = ? ORDER BY created_at ASC').all(projectId)
    }
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
        SET type = @type, name = @name, runtime = @runtime,
            project_id = @project_id, template_id = @template_id,
            system_prompt = @system_prompt, icon = @icon
        WHERE id = @id
      `).run(updated)
      return updated
    }
    return agentStore.create(input)
  },
}
