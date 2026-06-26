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
  lastReadAt: string | null
  closedAt: string | null
}

interface SessionState {
  sessions: MobileSessionItem[]
  loading: boolean
  filterAgent: string | null
  filterStatus: string | null
  runningSessionIds: SessionIndicatorMap
  currentSessionId: string | null

  fetchSessions: (projectId?: string | null) => Promise<void>
  setFilterAgent: (agentId: string | null) => void
  setFilterStatus: (status: string | null) => void
  setCurrentSession: (sessionId: string | null) => void
  markRead: (sessionId: string) => Promise<void>
  setupListeners: () => () => void
}

let sessionListRequestSeq = 0
let sessionListRefreshTimer: ReturnType<typeof setTimeout> | null = null
const SESSION_LIST_REFRESH_DEBOUNCE_MS = 300

function timestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function isSessionUnread(
  session: { last_message_at?: string | null; last_read_at?: string | null },
  currentSessionId: string | null,
  sessionId: string,
): boolean {
  if (currentSessionId === sessionId) return false
  const lastMessageMs = timestampMs(session.last_message_at)
  if (!lastMessageMs) return false
  const lastReadMs = timestampMs(session.last_read_at)
  // Old servers don't have last_read_at (migration 022 missing). Treat missing
  // as read to avoid painting every session unread on version mismatch.
  if (!lastReadMs) return false
  return lastMessageMs > lastReadMs
}

function removeIndicator(source: SessionIndicatorMap, sessionId: string): SessionIndicatorMap {
  if (!source[sessionId]) return source
  const next = { ...source }
  delete next[sessionId]
  return next
}

function addIndicator(source: SessionIndicatorMap, sessionId: string): SessionIndicatorMap {
  return { ...source, [sessionId]: true } as SessionIndicatorMap
}

function mapSession(session: SessionData, currentSessionId: string | null): MobileSessionItem {
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
    unread: isSessionUnread(session, currentSessionId, session.id),
    startedAt: session.started_at,
    updatedAt: session.updated_at ?? null,
    lastMessageAt: session.last_message_at ?? null,
    lastReadAt: session.last_read_at ?? null,
    closedAt: session.closed_at,
  }
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
        return {
          sessions: data.map((session) => mapSession(session, state.currentSessionId)),
          runningSessionIds: reconcileRunning(state.runningSessionIds, data, preserveMissingIndicators),
          loading: false,
        }
      })
    } catch {
      if (requestSeq === sessionListRequestSeq) set({ loading: false })
    }
  },

  setFilterAgent: (agentId) => set({ filterAgent: agentId }),
  setFilterStatus: (status) => set({ filterStatus: status }),
  setCurrentSession: (sessionId) => {
    set({ currentSessionId: sessionId })
    if (sessionId) {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId ? { ...session, unread: false } : session
        ),
      }))
    }
  },

  markRead: async (sessionId) => {
    const lastReadAt = new Date().toISOString()
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? { ...session, unread: false, lastReadAt }
          : session
      ),
    }))
    try {
      await wsClient.request({ type: 'sessions.markRead', sessionId })
    } catch {
      // Best-effort: the optimistic update above keeps the UI correct locally.
      // The next fetchSessions will resync from the server.
    }
  },

  setupListeners: () => {
    // 重连或批量事件时,服务端会补发一串 session:activity / session:done /
    // session:changed,每个原本都调一次 fetchSessions,造成列表反复重排。
    // 防抖到 300ms 内只发一次请求。
    const refresh = () => {
      if (sessionListRefreshTimer) return
      sessionListRefreshTimer = setTimeout(() => {
        sessionListRefreshTimer = null
        void get().fetchSessions(useAppStore.getState().currentProjectId)
      }, SESSION_LIST_REFRESH_DEBOUNCE_MS)
    }
    const markRunning = (sessionId: string) => {
      set((state) => ({
        runningSessionIds: addIndicator(state.runningSessionIds, sessionId),
        sessions: state.sessions.map((session) =>
          session.id === sessionId ? { ...session, activityState: 'running' } : session
        ),
      }))
    }
    const markIdle = (sessionId: string) => {
      set((state) => ({
        runningSessionIds: removeIndicator(state.runningSessionIds, sessionId),
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                activityState: 'idle',
                // Don't override the unread flag here: a fresh fetchSessions will
                // recompute it from last_message_at/last_read_at. Setting it from
                // possibly-stale local fields caused the yellow flash after the
                // green running dot disappeared.
              }
            : session
        ),
      }))
    }
    const off1 = wsClient.on('session:activity', (msg) => {
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : ''
      if (!sessionId) return
      if (msg.state === 'running') {
        markRunning(sessionId)
        refresh()
      } else {
        markIdle(sessionId)
        refresh()
      }
    })
    const off2 = wsClient.on('session:done', (msg) => {
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : ''
      if (!sessionId) return
      markIdle(sessionId)
      refresh()
    })
    const off3 = wsClient.on('session:changed', (msg) => {
      const data = msg.data as Record<string, unknown> | undefined
      if (data && typeof data.lastReadAt === 'string') {
        const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : ''
        const lastReadAt = data.lastReadAt
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  lastReadAt,
                  unread: isSessionUnread(
                    { last_message_at: session.lastMessageAt, last_read_at: lastReadAt },
                    state.currentSessionId,
                    sessionId,
                  ),
                }
              : session
          ),
        }))
      } else {
        refresh()
      }
    })
    return () => {
      off1()
      off2()
      off3()
      if (sessionListRefreshTimer) {
        clearTimeout(sessionListRefreshTimer)
        sessionListRefreshTimer = null
      }
    }
  },
}))
