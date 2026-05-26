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
}

interface AgentStore {
  agents: AgentData[]
  loading: boolean
  fetchAgents: () => Promise<void>
  createAgent: (name: string, agentType: string, runtime: string) => Promise<AgentData>
  setupListeners: () => () => void
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  loading: false,

  fetchAgents: async () => {
    set({ loading: true })
    try {
      const data = await wsClient.request({ type: 'agents.list' }) as AgentData[]
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
