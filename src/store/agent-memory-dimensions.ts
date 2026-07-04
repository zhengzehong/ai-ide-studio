import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface AgentMemoryDimensionRow {
  id: string
  project_id: string
  agent_id: string
  name: string
  description: string | null
  prompt: string | null
  is_builtin: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CreateAgentMemoryDimensionInput {
  projectId: string
  agentId: string
  name: string
  description?: string | null
  prompt?: string | null
  isBuiltin?: boolean
}

export interface UpdateAgentMemoryDimensionInput {
  name?: string
  description?: string | null
  prompt?: string | null
}

export const agentMemoryDimensionStore = {
  create(input: CreateAgentMemoryDimensionInput): AgentMemoryDimensionRow {
    const now = new Date().toISOString()
    const row: AgentMemoryDimensionRow = {
      id: `amd-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId,
      agent_id: input.agentId,
      name: input.name,
      description: input.description ?? null,
      prompt: input.prompt ?? null,
      is_builtin: input.isBuiltin ? 1 : 0,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    getDb().prepare(`
      INSERT INTO agent_memory_dimensions (
        id, project_id, agent_id, name, description, prompt, is_builtin,
        created_at, updated_at, deleted_at
      )
      VALUES (
        @id, @project_id, @agent_id, @name, @description, @prompt, @is_builtin,
        @created_at, @updated_at, @deleted_at
      )
    `).run(row)
    return row
  },

  get(id: string): AgentMemoryDimensionRow | undefined {
    return getDb()
      .prepare<[string], AgentMemoryDimensionRow>(
        'SELECT * FROM agent_memory_dimensions WHERE id = ? AND deleted_at IS NULL',
      )
      .get(id)
  },

  getByNames(projectId: string, agentId: string, name: string): AgentMemoryDimensionRow | undefined {
    return getDb()
      .prepare<[string, string, string], AgentMemoryDimensionRow>(`
        SELECT * FROM agent_memory_dimensions
        WHERE project_id = ? AND agent_id = ? AND name = ? AND deleted_at IS NULL
      `)
      .get(projectId, agentId, name)
  },

  listByAgent(projectId: string, agentId: string): AgentMemoryDimensionRow[] {
    return getDb()
      .prepare<[string, string], AgentMemoryDimensionRow>(`
        SELECT * FROM agent_memory_dimensions
        WHERE project_id = ? AND agent_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC
      `)
      .all(projectId, agentId)
  },

  countByAgent(projectId: string, agentId: string): number {
    const row = getDb()
      .prepare<[string, string], { count: number }>(`
        SELECT COUNT(*) AS count FROM agent_memory_dimensions
        WHERE project_id = ? AND agent_id = ? AND deleted_at IS NULL
      `)
      .get(projectId, agentId)
    return row?.count ?? 0
  },

  countCustomByAgent(projectId: string, agentId: string): number {
    const row = getDb()
      .prepare<[string, string], { count: number }>(`
        SELECT COUNT(*) AS count FROM agent_memory_dimensions
        WHERE project_id = ? AND agent_id = ? AND deleted_at IS NULL AND is_builtin = 0
      `)
      .get(projectId, agentId)
    return row?.count ?? 0
  },

  listByProject(projectId: string): AgentMemoryDimensionRow[] {
    return getDb()
      .prepare<[string], AgentMemoryDimensionRow>(`
        SELECT * FROM agent_memory_dimensions
        WHERE project_id = ? AND deleted_at IS NULL
        ORDER BY agent_id ASC, created_at ASC
      `)
      .all(projectId)
  },

  update(id: string, input: UpdateAgentMemoryDimensionInput): AgentMemoryDimensionRow | undefined {
    const current = agentMemoryDimensionStore.get(id)
    if (!current) return undefined
    const next: AgentMemoryDimensionRow = {
      ...current,
      name: input.name ?? current.name,
      description: input.description !== undefined ? input.description : current.description,
      prompt: input.prompt !== undefined ? input.prompt : current.prompt,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE agent_memory_dimensions SET
        name = @name,
        description = @description,
        prompt = @prompt,
        updated_at = @updated_at
      WHERE id = @id
    `).run(next)
    return agentMemoryDimensionStore.get(id)
  },

  softDelete(id: string): void {
    getDb()
      .prepare('UPDATE agent_memory_dimensions SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), id)
  },
}
