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
  sort_order: number | null
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



export interface UpdateAgentInput {
  name?: string
  type?: string
  runtime?: string
  status?: string
  permissionLevel?: number
  config?: Record<string, unknown> | null
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
      sort_order: nextAgentSortOrder(input.projectId ?? null),
    }
    getDb().prepare(`
      INSERT INTO agents (id, type, name, runtime, status, permission_level, config_json, created_at, project_id, template_id, system_prompt, icon, sort_order)
      VALUES (@id, @type, @name, @runtime, @status, @permission_level, @config_json, @created_at, @project_id, @template_id, @system_prompt, @icon, @sort_order)
    `).run(agent)
    return agent
  },

  get(id: string): AgentRow | undefined {
    return getDb().prepare<[string], AgentRow>('SELECT * FROM agents WHERE id = ?').get(id)
  },

  list(projectId?: string): AgentRow[] {
    if (projectId) {
      return getDb().prepare<[string], AgentRow>('SELECT * FROM agents WHERE project_id = ? ORDER BY COALESCE(sort_order, 9223372036854775807) ASC, created_at ASC, id ASC').all(projectId)
    }
    return getDb().prepare<[], AgentRow>('SELECT * FROM agents ORDER BY created_at ASC').all()
  },

  reorder(projectId: string, agentIds: string[]): AgentRow[] {
    if (!projectId) throw new Error('projectId is required')
    const uniqueIds = uniqueOrderedIds(agentIds)
    const current = agentStore.list(projectId)
    const currentById = new Map(current.map((agent) => [agent.id, agent]))
    for (const agentId of uniqueIds) {
      if (!currentById.has(agentId)) throw new Error(`Agent does not belong to project: ${agentId}`)
    }
    const orderedIds = [...uniqueIds, ...current.filter((agent) => !uniqueIds.includes(agent.id)).map((agent) => agent.id)]
    const update = getDb().prepare('UPDATE agents SET sort_order = ? WHERE id = ? AND project_id = ?')
    const apply = getDb().transaction(() => {
      orderedIds.forEach((agentId, index) => update.run(index + 1, agentId, projectId))
    })
    apply()
    return agentStore.list(projectId)
  },

  updateStatus(id: string, status: string): void {
    getDb().prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id)
  },

  update(id: string, fields: UpdateAgentInput): AgentRow | undefined {
    const existing = agentStore.get(id)
    if (!existing) return undefined
    const updated: AgentRow = {
      ...existing,
      name: fields.name ?? existing.name,
      type: fields.type ?? existing.type,
      runtime: fields.runtime ?? existing.runtime,
      status: fields.status ?? existing.status,
      permission_level: fields.permissionLevel ?? existing.permission_level,
      config_json: fields.config !== undefined ? (fields.config ? JSON.stringify(fields.config) : null) : existing.config_json,
      system_prompt: fields.systemPrompt ?? existing.system_prompt,
      icon: fields.icon ?? existing.icon,
    }
    getDb().prepare(`
      UPDATE agents
      SET name = @name, type = @type, runtime = @runtime, status = @status,
          permission_level = @permission_level, config_json = @config_json,
          system_prompt = @system_prompt, icon = @icon
      WHERE id = @id
    `).run(updated)
    return updated
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

function nextAgentSortOrder(projectId: string | null): number {
  const db = getDb()
  const row = projectId
    ? db.prepare<[string], { min_order: number | null }>('SELECT MIN(sort_order) AS min_order FROM agents WHERE project_id = ?').get(projectId)
    : db.prepare<[], { min_order: number | null }>('SELECT MIN(sort_order) AS min_order FROM agents WHERE project_id IS NULL').get()
  return (row?.min_order ?? 1) - 1
}

function uniqueOrderedIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}
