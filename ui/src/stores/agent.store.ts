import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface AgentData {
  id: string
  type: string
  name: string
  runtime: string
  status: string
  permission_level: number
  config_json: string | null
  created_at: string
  project_id?: string | null
}

interface AgentStore {
  agents: AgentData[]
  loading: boolean
  fetchAgents: (projectId?: string) => Promise<void>
  createAgent: (name: string, agentType: string, runtime: string) => Promise<AgentData>
  setupListeners: () => () => void
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  loading: false,

  fetchAgents: async (projectId) => {
    set({ loading: true })
    try {
      const msg: Record<string, unknown> = { type: 'agents.list' }
      if (projectId) msg.projectId = projectId
      const data = await wsClient.request(msg) as AgentData[]
      set({ agents: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createAgent: async (name, agentType, runtime) => {
    const agent = await wsClient.request({ type: 'agents.create', name, agentType, runtime }) as AgentData
    set({ agents: [...get().agents, agent] })
    return agent
  },

  setupListeners: () => {
    const off = wsClient.on('agent:status', (msg) => {
      const agentId = msg.agentId as string
      const status = msg.status as string
      set({
        agents: get().agents.map(a => a.id === agentId ? { ...a, status } : a),
      })
    })
    return off
  },
}))
