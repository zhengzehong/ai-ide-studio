import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface WidgetAgentItem {
  agentId: string
  agentName: string
  agentIcon: string
  projectId: string | null
  projectName: string | null
  sessionId: string | null
  sessionTitle: string | null
  status: string
  stage: string
  isRunning: boolean
  isUnread: boolean
  startedAt: string | null
  closedAt: string | null
}

interface WidgetPreferences {
  pinnedProjectId: string | null
  pinnedAgentId: string | null
}

interface WidgetStore {
  agents: WidgetAgentItem[]
  agentsLoading: boolean
  preferences: WidgetPreferences
  preferencesLoaded: boolean

  fetchAgents: (projectId?: string | null, filter?: string) => Promise<void>
  markRead: (sessionId: string) => Promise<void>

  loadPreferences: () => Promise<void>
  setPinnedProject: (projectId: string | null) => Promise<void>
  setPinnedAgent: (agentId: string | null) => Promise<void>

  setupListeners: () => () => void
}

export const useWidgetStore = create<WidgetStore>((set, get) => ({
  agents: [],
  agentsLoading: false,
  preferences: { pinnedProjectId: null, pinnedAgentId: null },
  preferencesLoaded: false,

  fetchAgents: async (projectId, filter) => {
    set({ agentsLoading: true })
    try {
      const msg: Record<string, unknown> = { type: 'widget.agents.list' }
      if (projectId) msg.projectId = projectId
      if (filter) msg.filter = filter
      const data = (await wsClient.request(msg)) as WidgetAgentItem[]
      set({ agents: data, agentsLoading: false })
    } catch {
      set({ agentsLoading: false })
    }
  },

  markRead: async (sessionId) => {
    await wsClient.request({ type: 'widget.markRead', sessionId })
    set({
      agents: get().agents.map((a) =>
        a.sessionId === sessionId ? { ...a, isUnread: false } : a,
      ),
    })
  },

  loadPreferences: async () => {
    try {
      const data = (await wsClient.request({ type: 'widget.preferences.get' })) as Record<string, string>
      set({
        preferences: {
          pinnedProjectId: data.pinnedProjectId || null,
          pinnedAgentId: data.pinnedAgentId || null,
        },
        preferencesLoaded: true,
      })
    } catch {
      set({ preferencesLoaded: true })
    }
  },

  setPinnedProject: async (projectId) => {
    set({ preferences: { ...get().preferences, pinnedProjectId: projectId } })
    if (projectId) {
      await wsClient.request({ type: 'widget.preferences.set', key: 'pinnedProjectId', value: projectId })
    } else {
      await wsClient.request({ type: 'widget.preferences.set', key: 'pinnedProjectId', value: null })
    }
  },

  setPinnedAgent: async (agentId) => {
    set({ preferences: { ...get().preferences, pinnedAgentId: agentId } })
    if (agentId) {
      await wsClient.request({ type: 'widget.preferences.set', key: 'pinnedAgentId', value: agentId })
    } else {
      await wsClient.request({ type: 'widget.preferences.set', key: 'pinnedAgentId', value: null })
    }
  },

  setupListeners: () => {
    const off1 = wsClient.on('agent:status', () => {
      const { preferences } = get()
      get().fetchAgents(preferences.pinnedProjectId, 'active')
    })
    const off2 = wsClient.on('session:activity', () => {
      const { preferences } = get()
      get().fetchAgents(preferences.pinnedProjectId, 'active')
    })
    const off3 = wsClient.on('session:done', () => {
      const { preferences } = get()
      get().fetchAgents(preferences.pinnedProjectId, 'active')
    })
    return () => {
      off1()
      off2()
      off3()
    }
  },
}))
