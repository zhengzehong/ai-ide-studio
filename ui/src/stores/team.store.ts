import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import type { TaskData } from './task.store'
import { beginProjectRequest, commitProjectResponse, emptyProjectCache, pruneProjectCache, readProjectCache, type ProjectCacheState } from './project-cache'
import { useConnectionStore } from './connection.store'

export interface TeamData {
  id: string
  project_id: string
  name: string
  description: string | null
  master_prompt?: string
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
  model_profile_id: string | null
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
  teams: TeamData[]
  teamsLoading: boolean
  activeProjectId: string | null
  teamCache: ProjectCacheState<TeamData[]>
  fetchTeams: (projectId?: string | null, force?: boolean) => Promise<void>
  current: TeamContextData
  currentSessionId: string | null
  loading: boolean
  fetchCurrent: (sessionId?: string | null) => Promise<void>
  clearCurrent: () => void
  setupListeners: (getCurrentSessionId: () => string | null) => () => void
}

const teamRequests = new Map<string, Promise<void>>()
let identityVersion = 0
export const useTeamStore = create<TeamStore>((set, get) => ({
  teams: [],
  teamsLoading: false,
  activeProjectId: null,
  teamCache: emptyProjectCache(),
  fetchTeams: async (projectId, force = false) => {
    if (!projectId) {
      set({ teams: [], teamsLoading: false, activeProjectId: null })
      return
    }
    const cached = readProjectCache(get().teamCache, projectId)
    set({ activeProjectId: projectId, teams: cached?.data || [], teamsLoading: !cached })
    const existing = teamRequests.get(projectId)
    if (existing && !force) return existing
    const request = beginProjectRequest(get().teamCache, projectId)
    set({ teamCache: request.state })
    const identity = identityVersion
    const pending = (async (): Promise<void> => {
      try {
        const teams = await wsClient.request({ type: 'teams.list', projectId }) as TeamData[]
        if (identity !== identityVersion || get().teamCache.requestSeqByScope[projectId] !== request.requestSeq) return
        const data = Array.isArray(teams) ? teams : []
        const committed = commitProjectResponse(get().teamCache, { scope: projectId, requestSeq: request.requestSeq, data })
        set({ teamCache: pruneProjectCache(committed, get().activeProjectId || projectId), ...(get().activeProjectId === projectId ? { teams: data, teamsLoading: false } : {}) })
      } catch {
        if (identity === identityVersion && get().activeProjectId === projectId && get().teamCache.requestSeqByScope[projectId] === request.requestSeq) set({ teamsLoading: false })
      } finally {
        if (get().teamCache.requestSeqByScope[projectId] === request.requestSeq && identity === identityVersion) teamRequests.delete(projectId)
      }
    })()
    teamRequests.set(projectId, pending)
    return pending
  },
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
      const data = msg.data as Record<string, unknown> | undefined
      if (['created', 'updated', 'archived', 'deleted'].includes(String(data?.reason)) && get().activeProjectId) void get().fetchTeams(get().activeProjectId, true)
    })
  },
}))

useConnectionStore.subscribe((state, previous) => {
  if (state.token === previous.token && state.authMode === previous.authMode) return
  identityVersion++
  teamRequests.clear()
  useTeamStore.setState({ teamCache: emptyProjectCache(), teams: [], teamsLoading: false, activeProjectId: null })
})
