import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'
import { useConversationCatalog } from './conversation-catalog.store'
import { projectTeamPins } from '../utils/team-list-projections'

export interface MobilePinnedSession {
  teamId?: string
  conversationId?: string
  sessionId: string
  sessionTitle: string | null
  stage: string
  agentId: string
  agentName: string
  projectId: string
  projectName: string
  projectColor: string | null
  projectIcon: string | null
  activityState: 'running' | 'idle'
  unread: boolean
  lastActivityAt: string
  sortOrder: number | null
  addedAt: string | null
}

interface PinnedSessionState {
  items: MobilePinnedSession[]
  loading: boolean
  loaded: boolean
  error: string | null
  removing: Record<string, boolean>
  reordering: boolean
  load: (options?: { silent?: boolean }) => Promise<void>
  add: (sessionId: string) => Promise<void>
  remove: (sessionId: string) => Promise<void>
  markRead: (sessionId: string) => Promise<void>
  reorder: (sessionIds: string[]) => Promise<void>
  isPinned: (sessionId: string) => boolean
  setupListeners: () => () => void
}

let requestSequence = 0

export const usePinnedSessionStore = create<PinnedSessionState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  error: null,
  removing: {},
  reordering: false,

  load: async (options) => {
    const sequence = ++requestSequence
    if (!options?.silent) set({ loading: true, error: null })
    try {
      const items = await wsClient.request({ type: 'sessionDock.list' }) as MobilePinnedSession[]
      if (sequence !== requestSequence) return
      set({ items, loading: false, loaded: true, error: null })
    } catch (error) {
      if (sequence !== requestSequence) return
      set({ loading: false, error: error instanceof Error ? error.message : '加载置顶会话失败' })
    }
  },

  add: async (sessionId) => {
    requestSequence += 1
    try {
      const item = await wsClient.request({ type: 'sessionDock.add', sessionId }) as MobilePinnedSession
      set((state) => ({
        items: sortItems([item, ...state.items.filter((current) => current.sessionId !== sessionId)]),
        loaded: true,
        loading: false,
        error: null,
      }))
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '置顶会话失败' })
    }
  },

  remove: async (sessionId) => {
    requestSequence += 1
    set((state) => ({ removing: { ...state.removing, [sessionId]: true }, error: null, loading: false }))
    try {
      await wsClient.request({ type: 'sessionDock.remove', sessionId })
      set((state) => ({
        items: state.items.filter((item) => item.sessionId !== sessionId),
        removing: withoutKey(state.removing, sessionId),
        loading: false,
      }))
    } catch (error) {
      set((state) => ({
        removing: withoutKey(state.removing, sessionId),
        loading: false,
        error: error instanceof Error ? error.message : '取消置顶失败',
      }))
    }
  },

  markRead: async (sessionId) => {
    requestSequence += 1
    set((state) => ({
      items: state.items.map((item) => item.sessionId === sessionId ? { ...item, unread: false } : item),
      loading: false,
    }))
    try {
      await wsClient.request({ type: 'sessions.markRead', sessionId })
    } catch {
      void get().load({ silent: true })
    }
  },

  reorder: async (sessionIds) => {
    requestSequence += 1
    const previous = get().items
    const visibleIds = new Set(projectTeamPins(previous, useConversationCatalog.getState().catalog).map(item => item.sessionId))
    const omitted = previous.filter(item => !sessionIds.includes(item.sessionId))
    if (omitted.some(item => visibleIds.has(item.sessionId))) return
    sessionIds = [...sessionIds, ...omitted.map(item => item.sessionId)]
    const byId = new Map(previous.map((item) => [item.sessionId, item]))
    const optimistic = sessionIds.flatMap((sessionId, index) => {
      const item = byId.get(sessionId)
      return item ? [{ ...item, sortOrder: index + 1 }] : []
    })
    if (optimistic.length !== previous.length) return
    requestSequence += 1
    set({ items: optimistic, reordering: true, error: null, loading: false })
    try {
      const items = await wsClient.request({ type: 'sessionDock.reorder', sessionIds }) as MobilePinnedSession[]
      set({ items, reordering: false, loading: false })
    } catch (error) {
      set({ items: previous, reordering: false, loading: false, error: error instanceof Error ? error.message : '排序保存失败' })
    }
  },

  isPinned: (sessionId) => get().items.some((item) => item.sessionId === sessionId),

  setupListeners: () => {
    const refresh = (): void => { void get().load({ silent: true }) }
    const refreshRelevant = (message: Record<string, unknown>): void => {
      const sessionId = typeof message.sessionId === 'string' ? message.sessionId : ''
      if (sessionId && get().items.some((item) => item.sessionId === sessionId)) refresh()
    }
    const unsubscribers = [
      wsClient.on('session-dock:update', refresh),
      wsClient.on('session:activity', refreshRelevant),
      wsClient.on('session:done', refreshRelevant),
      wsClient.on('session:changed', refreshRelevant),
      wsClient.on('reconnected', refresh),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  },
}))

function sortItems(items: MobilePinnedSession[]): MobilePinnedSession[] {
  return [...items].sort((left, right) => {
    const order = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER)
    if (order !== 0) return order
    return Date.parse(right.addedAt ?? '') - Date.parse(left.addedAt ?? '')
  })
}

function withoutKey(record: Record<string, boolean>, key: string): Record<string, boolean> {
  const next = { ...record }
  delete next[key]
  return next
}
