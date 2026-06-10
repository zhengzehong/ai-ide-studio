import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'

interface ProjectItem {
  id: string
  name: string
  path?: string
}

interface AgentItem {
  id: string
  name: string
  type?: string
  model?: string
}

interface AppState {
  projects: ProjectItem[]
  agents: AgentItem[]
  currentProjectId: string | null
  fetchProjects: () => Promise<void>
  fetchAgents: () => Promise<void>
  setCurrentProject: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  projects: [],
  agents: [],
  currentProjectId: null,

  fetchProjects: async () => {
    try {
      const data = await wsClient.request({ type: 'projects.list' }) as ProjectItem[]
      set({ projects: data })
    } catch { /* ignore */ }
  },

  fetchAgents: async () => {
    try {
      const data = await wsClient.request({ type: 'agents.list' }) as AgentItem[]
      set({ agents: data })
    } catch { /* ignore */ }
  },

  setCurrentProject: (id) => set({ currentProjectId: id }),
}))
