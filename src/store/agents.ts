import { randomUUID } from 'crypto'
import { getData, persist } from './db.js'

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
    const data = getData()
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
    data.agents[id] = agent
    persist()
    return agent
  },

  get(id: string): AgentRow | undefined {
    const data = getData()
    return data.agents[id] as AgentRow | undefined
  },

  list(): AgentRow[] {
    const data = getData()
    return Object.values(data.agents) as AgentRow[]
  },

  updateStatus(id: string, status: string): void {
    const data = getData()
    const agent = data.agents[id] as AgentRow | undefined
    if (agent) {
      agent.status = status
      persist()
    }
  },

  delete(id: string): void {
    const data = getData()
    delete data.agents[id]
    persist()
  },

  upsert(input: CreateAgentInput): AgentRow {
    const existing = input.id ? agentStore.get(input.id) : undefined
    if (existing) {
      const data = getData()
      existing.type = input.type
      existing.name = input.name
      existing.runtime = input.runtime
      data.agents[existing.id] = existing
      persist()
      return existing
    }
    return agentStore.create(input)
  },
}
