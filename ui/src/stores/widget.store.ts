import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface WidgetSessionItem {
  sessionId: string
  agentId: string
  agentName: string
  agentIcon: string | null
  projectId: string | null
  projectName: string | null
  taskId: string | null
  taskTitle: string | null
  sessionTitle: string | null
  status: string
  activityState: 'running' | 'idle'
  stage: string
  unread: boolean
  startedAt: string
  lastMessageAt: string | null
  completedAt: string | null
  closedAt: string | null
}

interface WidgetPreferences {
  pinnedProjectId: string | null
  pinnedAgentId: string | null
}

interface WidgetStore {
  sessions: WidgetSessionItem[]
  sessionsLoading: boolean
  preferences: WidgetPreferences
  preferencesLoaded: boolean

  fetchSessions: (projectId?: string | null, filter?: string) => Promise<void>
  markSessionRead: (sessionId: string) => Promise<void>

  loadPreferences: () => Promise<void>
  setPinnedProject: (projectId: string | null) => Promise<void>
  setPinnedAgent: (agentId: string | null) => Promise<void>

  setupListeners: () => () => void
}

export const useWidgetStore = create<WidgetStore>((set, get) => ({
  sessions: [],
  sessionsLoading: false,
  preferences: { pinnedProjectId: null, pinnedAgentId: null },
  preferencesLoaded: false,

  fetchSessions: async (projectId, filter) => {
    set({ sessionsLoading: true })
    try {
      const msg: Record<string, unknown> = { type: 'widget.sessions.list' }
      if (projectId) msg.projectId = projectId
      if (filter) msg.filter = filter
      const data = (await wsClient.request(msg)) as WidgetSessionItem[]
      set({ sessions: data, sessionsLoading: false })
    } catch {
      set({ sessionsLoading: false })
    }
  },

  markSessionRead: async (sessionId) => {
    await wsClient.request({ type: 'widget.sessions.markRead', sessionId })
    set({
      sessions: get().sessions.flatMap((session) => {
        if (session.sessionId !== sessionId) return [session]
        if (session.activityState !== 'running') return []
        return [{ ...session, unread: false }]
      }),
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
    await wsClient.request({ type: 'widget.preferences.set', key: 'pinnedProjectId', value: projectId })
  },

  setPinnedAgent: async (agentId) => {
    set({ preferences: { ...get().preferences, pinnedAgentId: agentId } })
    await wsClient.request({ type: 'widget.preferences.set', key: 'pinnedAgentId', value: agentId })
  },

  setupListeners: () => {
    const refresh = () => {
      const { preferences } = get()
      void get().fetchSessions(preferences.pinnedProjectId, 'active')
    }
    const off1 = wsClient.on('agent:status', refresh)
    const off2 = wsClient.on('session:activity', refresh)
    const off3 = wsClient.on('session:done', refresh)
    const off4 = wsClient.on('session:changed', refresh)
    return () => {
      off1()
      off2()
      off3()
      off4()
    }
  },
}))
