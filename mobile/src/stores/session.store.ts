import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'
import type { SessionData } from '@desktop/stores/session.store'
import { useAppStore } from './app.store'

export type MobileSessionActivityState = 'running' | 'idle'
type SessionIndicatorMap = Record<string, true>

export interface MobileSessionItem {
  id: string
  agentId: string
  agentName: string
  projectId: string | null
  projectName: string | null
  taskId: string | null
  sessionTitle: string | null
  status: string
  activityState: MobileSessionActivityState
  stage: string
  unread: boolean
  startedAt: string
  updatedAt: string | null
  lastMessageAt: string | null
  closedAt: string | null
}

interface SessionState {
  sessions: MobileSessionItem[]
  loading: boolean
  filterAgent: string | null
  filterStatus: string | null
  runningSessionIds: SessionIndicatorMap
  unreadSessionIds: SessionIndicatorMap
  protectedUnreadSessionIds: SessionIndicatorMap
  currentSessionId: string | null

  fetchSessions: (projectId?: string | null) => Promise<void>
  setFilterAgent: (agentId: string | null) => void
  setFilterStatus: (status: string | null) => void
  setCurrentSession: (sessionId: string | null) => void
  markRead: (sessionId: string) => Promise<void>
  setupListeners: () => () => void
}

let sessionListRequestSeq = 0

function removeIndicator(source: SessionIndicatorMap, sessionId: string): SessionIndicatorMap {
  if (!source[sessionId]) return source
  const next = { ...source }
  delete next[sessionId]
  return next
}

function addIndicator(source: SessionIndicatorMap, sessionId: string): SessionIndicatorMap {
  return { ...source, [sessionId]: true } as SessionIndicatorMap
}

function mapSession(session: SessionData, unreadSessionIds: SessionIndicatorMap): MobileSessionItem {
  const { agents, projects } = useAppStore.getState()
  const agent = agents.find((item) => item.id === session.agent_id)
  const project = session.project_id ? projects.find((item) => item.id === session.project_id) : undefined
  return {
    id: session.id,
    agentId: session.agent_id,
    agentName: agent?.name ?? session.agent_id,
    projectId: session.project_id ?? null,
    projectName: project?.name ?? null,
    taskId: session.task_id,
    sessionTitle: session.title ?? null,
    status: session.status,
    activityState: session.activity_state === 'running' ? 'running' : 'idle',
    stage: session.stage,
    unread: !!unreadSessionIds[session.id],
    startedAt: session.started_at,
    updatedAt: session.updated_at ?? null,
    lastMessageAt: session.last_message_at ?? null,
    closedAt: session.closed_at,
  }
}

function reconcileUnread(
  unreadSessionIds: SessionIndicatorMap,
  protectedUnreadSessionIds: SessionIndicatorMap,
  sessions: SessionData[],
  preserveMissing: boolean,
): SessionIndicatorMap {
  const ids = new Set(sessions.map((session) => session.id))
  const next: SessionIndicatorMap = preserveMissing ? { ...unreadSessionIds } : {}
  for (const sessionId of Object.keys(unreadSessionIds)) {
    if (ids.has(sessionId)) next[sessionId] = true
  }
  for (const session of sessions) {
    if (session.activity_state === 'running' && !protectedUnreadSessionIds[session.id]) delete next[session.id]
  }
  return next
}

function reconcileRunning(
  runningSessionIds: SessionIndicatorMap,
  sessions: SessionData[],
  preserveMissing: boolean,
): SessionIndicatorMap {
  const running: SessionIndicatorMap = preserveMissing ? { ...runningSessionIds } : {}
  for (const session of sessions) delete running[session.id]
  for (const session of sessions) {
    if (session.activity_state === 'running') running[session.id] = true
  }
  return running
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  loading: false,
  filterAgent: null,
  filterStatus: null,
  runningSessionIds: {},
  unreadSessionIds: {},
  protectedUnreadSessionIds: {},
  currentSessionId: null,

  fetchSessions: async (projectId) => {
    const requestSeq = ++sessionListRequestSeq
    set({ loading: true })
    try {
      const msg: Record<string, unknown> = { type: 'sessions.list' }
      if (projectId) msg.projectId = projectId
      const data = (await wsClient.request(msg)) as SessionData[]
      if (requestSeq !== sessionListRequestSeq) return
      set((state) => {
        const preserveMissingIndicators = !!projectId
        const unreadSessionIds = reconcileUnread(state.unreadSessionIds, state.protectedUnreadSessionIds, data, preserveMissingIndicators)
        return {
          sessions: data.map((session) => mapSession(session, unreadSessionIds)),
          runningSessionIds: reconcileRunning(state.runningSessionIds, data, preserveMissingIndicators),
          unreadSessionIds,
          loading: false,
        }
      })
    } catch {
      if (requestSeq === sessionListRequestSeq) set({ loading: false })
    }
  },

  setFilterAgent: (agentId) => set({ filterAgent: agentId }),
  setFilterStatus: (status) => set({ filterStatus: status }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

  markRead: async (sessionId) => {
    set((state) => {
      const unreadSessionIds = removeIndicator(state.unreadSessionIds, sessionId)
      const protectedUnreadSessionIds = removeIndicator(state.protectedUnreadSessionIds, sessionId)
      return {
        unreadSessionIds,
        protectedUnreadSessionIds,
        sessions: state.sessions.map((session) =>
          session.id === sessionId ? { ...session, unread: false } : session
        ),
      }
    })
  },

  setupListeners: () => {
    const refresh = () => void get().fetchSessions(useAppStore.getState().currentProjectId)
    let delayedRefreshTimer: ReturnType<typeof setTimeout> | null = null
    const refreshAfterPersistence = () => {
      refresh()
      if (delayedRefreshTimer) clearTimeout(delayedRefreshTimer)
      delayedRefreshTimer = setTimeout(refresh, 500)
    }
    const markRunning = (sessionId: string) => {
      set((state) => ({
        runningSessionIds: addIndicator(state.runningSessionIds, sessionId),
        unreadSessionIds: removeIndicator(state.unreadSessionIds, sessionId),
        protectedUnreadSessionIds: removeIndicator(state.protectedUnreadSessionIds, sessionId),
        sessions: state.sessions.map((session) =>
          session.id === sessionId ? { ...session, activityState: 'running', unread: false } : session
        ),
      }))
    }
    const markIdle = (sessionId: string) => {
      set((state) => {
        const runningSessionIds = removeIndicator(state.runningSessionIds, sessionId)
        const shouldMarkUnread = state.currentSessionId !== sessionId
        const unreadSessionIds = shouldMarkUnread
          ? addIndicator(state.unreadSessionIds, sessionId)
          : removeIndicator(state.unreadSessionIds, sessionId)
        const protectedUnreadSessionIds = shouldMarkUnread
          ? addIndicator(state.protectedUnreadSessionIds, sessionId)
          : removeIndicator(state.protectedUnreadSessionIds, sessionId)
        return {
          runningSessionIds,
          unreadSessionIds,
          protectedUnreadSessionIds,
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, activityState: 'idle', unread: !!unreadSessionIds[sessionId] }
              : session
          ),
        }
      })
    }
    const off1 = wsClient.on('session:activity', (msg) => {
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : ''
      if (!sessionId) return
      if (msg.state === 'running') markRunning(sessionId)
      else markIdle(sessionId)
      if (msg.state === 'running') refresh()
      else refreshAfterPersistence()
    })
    const off2 = wsClient.on('session:done', (msg) => {
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : ''
      if (!sessionId) return
      markIdle(sessionId)
      refreshAfterPersistence()
    })
    const off3 = wsClient.on('session:changed', refresh)
    return () => {
      if (delayedRefreshTimer) clearTimeout(delayedRefreshTimer)
      off1()
      off2()
      off3()
    }
  },
}))
