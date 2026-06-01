import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import type { TaskData } from './task.store'

export interface TeamData {
  id: string
  project_id: string
  name: string
  description: string | null
  status: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface TeamMemberData {
  id: string
  team_id: string
  project_id: string
  agent_id: string
  session_id: string
  name: string
  role: string
  status: string
  created_at: string
  updated_at: string
}

export interface TeamMailboxData {
  id: string
  team_id: string
  project_id: string
  from_member_id: string | null
  to_member_id: string | null
  task_id: string | null
  type: string
  content: string
  payload_json: string | null
  created_at: string
}

export interface TeamContextData {
  team: TeamData | null
  currentMember: TeamMemberData | null
  members: TeamMemberData[]
  tasks: TaskData[]
  mailbox: TeamMailboxData[]
}

const emptyContext: TeamContextData = {
  team: null,
  currentMember: null,
  members: [],
  tasks: [],
  mailbox: [],
}

interface TeamStore {
  current: TeamContextData
  currentSessionId: string | null
  loading: boolean
  fetchCurrent: (sessionId?: string | null) => Promise<void>
  clearCurrent: () => void
  setupListeners: (getCurrentSessionId: () => string | null) => () => void
}

export const useTeamStore = create<TeamStore>((set) => ({
  current: emptyContext,
  currentSessionId: null,
  loading: false,

  fetchCurrent: async (sessionId) => {
    if (!sessionId) {
      set({ current: emptyContext, currentSessionId: null, loading: false })
      return
    }
    set({ currentSessionId: sessionId, loading: true })
    try {
      const current = (await wsClient.request({ type: 'teams.current', sessionId })) as TeamContextData
      set((state) => (state.currentSessionId === sessionId ? { current, loading: false } : {}))
    } catch {
      set((state) => (state.currentSessionId === sessionId ? { current: emptyContext, loading: false } : {}))
    }
  },

  clearCurrent: () => set({ current: emptyContext, currentSessionId: null, loading: false }),

  setupListeners: (getCurrentSessionId) => {
    return wsClient.on('team:update', (msg) => {
      const sessionId = getCurrentSessionId()
      const sessionIds = Array.isArray(msg.sessionIds)
        ? msg.sessionIds.filter((id): id is string => typeof id === 'string')
        : []
      if (sessionId && sessionIds.includes(sessionId)) void useTeamStore.getState().fetchCurrent(sessionId)
    })
  },
}))
