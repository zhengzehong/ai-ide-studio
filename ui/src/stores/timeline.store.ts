import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import { wsRpc } from '../services/ws'

export interface TimelineSummaryData {
  id: string
  session_id: string
  turns: string
  summary: string
  status: 'raw' | 'refined'
  turn_start_at: string
  model_used: string | null
}

export interface TimelineConfigData {
  project_id: string
  enabled: number
  provider_id: string | null
  model: string | null
  api_key: string | null
  base_url: string | null
  trigger_interval: number
}

interface TimelineStore {
  items: TimelineSummaryData[]
  loading: boolean
  refining: boolean
  currentSessionId: string | null
  config: TimelineConfigData | null
  configLoading: boolean

  fetchTimeline: (sessionId: string) => Promise<void>
  refineTimeline: (sessionId: string) => Promise<void>
  generateTimeline: (sessionId: string) => Promise<void>
  fetchConfig: (projectId: string) => Promise<void>
  saveConfig: (projectId: string, fields: Partial<Omit<TimelineConfigData, 'project_id'>>) => Promise<void>
  clear: () => void
  setupListeners: () => () => void
}

export const useTimelineStore = create<TimelineStore>((set, get) => ({
  items: [],
  loading: false,
  refining: false,
  currentSessionId: null,
  config: null,
  configLoading: false,

  fetchTimeline: async (sessionId: string) => {
    set({ loading: true, currentSessionId: sessionId })
    try {
      const data = (await wsRpc('timeline.list', { sessionId })) as TimelineSummaryData[]
      if (get().currentSessionId === sessionId) {
        set({ items: data, loading: false })
      }
    } catch {
      set({ loading: false })
    }
  },

  refineTimeline: async (sessionId: string) => {
    set({ refining: true })
    try {
      await wsRpc('timeline.refine', { sessionId })
    } catch {
      // model refine errors handled by server
    } finally {
      set({ refining: false })
    }
  },

  generateTimeline: async (sessionId: string) => {
    set({ loading: true })
    try {
      await wsRpc('timeline.generate', { sessionId })
    } catch {
      // handled
    } finally {
      set({ loading: false })
    }
  },

  clear: () => set({ items: [], currentSessionId: null }),

  fetchConfig: async (projectId: string) => {
    set({ configLoading: true })
    try {
      const data = (await wsRpc('timeline.config.get', { projectId })) as TimelineConfigData | null
      set({ config: data, configLoading: false })
    } catch {
      set({ configLoading: false })
    }
  },

  saveConfig: async (projectId: string, fields: Partial<Omit<TimelineConfigData, 'project_id'>>) => {
    try {
      const data = (await wsRpc('timeline.config.save', {
        projectId,
        enabled: fields.enabled,
        providerId: fields.provider_id,
        model: fields.model,
        apiKey: fields.api_key,
        baseUrl: fields.base_url,
        triggerInterval: fields.trigger_interval,
      })) as TimelineConfigData
      set({ config: data })
    } catch {
      // save error
    }
  },

  setupListeners: () => {
    const off = wsClient.on('timeline:updated', (msg) => {
      const sessionId = msg.sessionId as string
      if (get().currentSessionId === sessionId) {
        get().fetchTimeline(sessionId)
      }
    })
    return off
  },
}))
