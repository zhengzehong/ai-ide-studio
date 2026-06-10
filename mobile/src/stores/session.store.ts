import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'
import type { WidgetSessionItem } from '@desktop/stores/widget.store'
import { useAppStore } from './app.store'

interface SessionState {
  sessions: WidgetSessionItem[]
  loading: boolean
  filterAgent: string | null
  filterStatus: string | null

  fetchSessions: (projectId?: string | null) => Promise<void>
  setFilterAgent: (agentId: string | null) => void
  setFilterStatus: (status: string | null) => void
  markRead: (sessionId: string) => Promise<void>
  setupListeners: () => () => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  loading: false,
  filterAgent: null,
  filterStatus: null,

  fetchSessions: async (projectId) => {
    set({ loading: true })
    try {
      const msg: Record<string, unknown> = { type: 'widget.sessions.list' }
      if (projectId) msg.projectId = projectId
      const data = (await wsClient.request(msg)) as WidgetSessionItem[]
      set({ sessions: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  setFilterAgent: (agentId) => set({ filterAgent: agentId }),
  setFilterStatus: (status) => set({ filterStatus: status }),

  markRead: async (sessionId) => {
    try {
      await wsClient.request({ type: 'widget.sessions.markRead', sessionId })
      set({
        sessions: get().sessions.map((s) =>
          s.sessionId === sessionId ? { ...s, unread: false } : s
        ),
      })
    } catch { /* ignore */ }
  },

  setupListeners: () => {
    const refresh = () => void get().fetchSessions(useAppStore.getState().currentProjectId)
    const off1 = wsClient.on('session:activity', refresh)
    const off2 = wsClient.on('session:done', refresh)
    const off3 = wsClient.on('session:changed', refresh)
    return () => { off1(); off2(); off3() }
  },
}))
