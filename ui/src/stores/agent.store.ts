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
  template_id?: string | null
  system_prompt?: string
  icon?: string
}

export interface ProjectAgentInput {
  name: string
  agentType: string
  runtime: string
  systemPrompt?: string
  icon?: string
  modelProfileId?: string
}

interface AgentStore {
  agents: AgentData[]
  loading: boolean
  fetchAgents: (projectId?: string) => Promise<void>
  createAgent: (name: string, agentType: string, runtime: string) => Promise<AgentData>
  deployTemplate: (projectId: string, templateId: string, input?: Partial<ProjectAgentInput>) => Promise<AgentData>
  createCustomAgent: (projectId: string, input: ProjectAgentInput) => Promise<AgentData>
  updateAgent: (agentId: string, input: Partial<ProjectAgentInput>) => Promise<AgentData>
  deleteAgent: (agentId: string) => Promise<void>
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

  deployTemplate: async (projectId, templateId, input = {}) => {
    const agent = await wsClient.request({ type: 'agents.deployTemplate', projectId, templateId, ...input }) as AgentData
    set({ agents: [...get().agents.filter(a => a.id !== agent.id), agent] })
    return agent
  },

  createCustomAgent: async (projectId, input) => {
    const agent = await wsClient.request({ type: 'agents.createCustom', projectId, ...input }) as AgentData
    set({ agents: [...get().agents.filter(a => a.id !== agent.id), agent] })
    return agent
  },

  updateAgent: async (agentId, input) => {
    const agent = await wsClient.request({ type: 'agents.update', agentId, ...input }) as AgentData
    set({ agents: get().agents.map(a => a.id === agentId ? agent : a) })
    return agent
  },

  deleteAgent: async (agentId) => {
    await wsClient.request({ type: 'agents.delete', agentId })
    set({ agents: get().agents.filter(a => a.id !== agentId) })
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
