import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export type WidgetAgentActivityState = 'running' | 'needs_input' | 'idle'

export interface WidgetAgentActivityItem {
  sessionId: string
  agentId: string
  agentName: string
  agentIcon: string | null
  projectId: string | null
  projectName: string | null
  taskId: string | null
  taskTitle: string | null
  taskStatus: string | null
  sessionTitle: string | null
  status: string
  activityState: WidgetAgentActivityState
  stage: string
  unread: boolean
  unreadCount: number
  startedAt: string
  updatedAt: string | null
  lastMessageAt: string | null
  completedAt: string | null
  closedAt: string | null
  activityAt: string
}

interface WidgetPreferences {
  pinnedProjectId: string | null
  pinnedAgentId: string | null
}

interface WidgetStore {
  activities: WidgetAgentActivityItem[]
  activitiesLoading: boolean
  activitiesError: string | null
  preferences: WidgetPreferences
  preferencesLoaded: boolean

  fetchActivities: (projectId?: string | null) => Promise<void>
  markSessionRead: (sessionId: string) => Promise<void>

  loadPreferences: () => Promise<void>
  setPinnedProject: (projectId: string | null) => Promise<void>
  setPinnedAgent: (agentId: string | null) => Promise<void>

  setupListeners: () => () => void
}

export const useWidgetStore = create<WidgetStore>((set, get) => ({
  activities: [],
  activitiesLoading: false,
  activitiesError: null,
  preferences: { pinnedProjectId: null, pinnedAgentId: null },
  preferencesLoaded: false,

  fetchActivities: async (projectId) => {
    set({ activitiesLoading: true, activitiesError: null })
    try {
      const msg: Record<string, unknown> = { type: 'widget.agentActivity.list' }
      if (projectId) msg.projectId = projectId
      const data = (await wsClient.request(msg)) as WidgetAgentActivityItem[]
      set({ activities: data, activitiesLoading: false, activitiesError: null })
    } catch (error) {
      set({
        activitiesLoading: false,
        activitiesError: error instanceof Error ? error.message : 'Agent 动态同步失败',
      })
    }
  },

  markSessionRead: async (sessionId) => {
    await wsClient.request({ type: 'widget.sessions.markRead', sessionId })
    set({
      activities: get().activities.map((activity) =>
        activity.sessionId === sessionId
          ? {
              ...activity,
              unread: false,
              unreadCount: Math.max(0, activity.unreadCount - 1),
            }
          : activity
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
    await wsClient.request({ type: 'widget.preferences.set', key: 'pinnedProjectId', value: projectId })
  },

  setPinnedAgent: async (agentId) => {
    set({ preferences: { ...get().preferences, pinnedAgentId: agentId } })
    await wsClient.request({ type: 'widget.preferences.set', key: 'pinnedAgentId', value: agentId })
  },

  setupListeners: () => {
    const refresh = () => {
      void get().fetchActivities(get().preferences.pinnedProjectId)
    }
    const unsubscribers = [
      wsClient.on('agent:status', refresh),
      wsClient.on('session:activity', refresh),
      wsClient.on('session:done', refresh),
      wsClient.on('session:changed', refresh),
      wsClient.on('task:update', refresh),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  },
}))
