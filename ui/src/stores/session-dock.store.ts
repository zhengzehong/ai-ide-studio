import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface SessionDockItem {
  sessionId: string
  sessionTitle: string | null
  stage: string
  agentId: string
  agentName: string
  agentIcon: string
  agentAvatarUrl: string | null
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

interface SessionDockStore {
  items: SessionDockItem[]
  candidates: SessionDockItem[]
  open: boolean
  pickerOpen: boolean
  loaded: boolean
  loading: boolean
  searching: boolean
  query: string
  error: string | null
  searchError: string | null
  adding: Record<string, boolean>
  removing: Record<string, boolean>
  reordering: boolean

  load: (options?: { silent?: boolean }) => Promise<void>
  openDrawer: () => Promise<void>
  closeDrawer: () => void
  openPicker: () => void
  closePicker: () => void
  search: (query: string) => Promise<void>
  add: (sessionId: string) => Promise<void>
  remove: (sessionId: string) => Promise<void>
  reorder: (sessionIds: string[]) => Promise<void>
  setupListeners: () => () => void
}

let searchGeneration = 0

export const useSessionDockStore = create<SessionDockStore>((set, get) => ({
  items: [],
  candidates: [],
  open: false,
  pickerOpen: false,
  loaded: false,
  loading: false,
  searching: false,
  query: '',
  error: null,
  searchError: null,
  adding: {},
  removing: {},
  reordering: false,

  load: async (options) => {
    if (!options?.silent) set({ loading: true, error: null })
    try {
      const items = await wsClient.request({ type: 'sessionDock.list' }) as SessionDockItem[]
      set({ items, loaded: true, loading: false, error: null })
    } catch (error) {
      set({ loading: false, error: errorMessage(error, '全局会话同步失败') })
    }
  },

  openDrawer: async () => {
    set({ open: true })
    if (!get().loaded) await get().load()
  },

  closeDrawer: () => {
    searchGeneration += 1
    set({ open: false, pickerOpen: false, searching: false, searchError: null })
  },

  openPicker: () => {
    set({ pickerOpen: true, query: '', candidates: [], searchError: null })
  },

  closePicker: () => {
    searchGeneration += 1
    set({ pickerOpen: false, candidates: [], searching: false, searchError: null })
  },

  search: async (query) => {
    const generation = ++searchGeneration
    set({ query, searching: true, searchError: null })
    try {
      const candidates = await wsClient.request({ type: 'sessionDock.search', query, limit: 40 }) as SessionDockItem[]
      if (generation !== searchGeneration) return
      set({ candidates, searching: false, searchError: null })
    } catch (error) {
      if (generation !== searchGeneration) return
      set({ searching: false, searchError: errorMessage(error, '会话搜索失败') })
    }
  },

  add: async (sessionId) => {
    set((state) => ({ adding: { ...state.adding, [sessionId]: true }, searchError: null }))
    try {
      const item = await wsClient.request({ type: 'sessionDock.add', sessionId }) as SessionDockItem
      set((state) => ({
        items: sortDockItems([item, ...state.items.filter((current) => current.sessionId !== sessionId)]),
        candidates: state.candidates.filter((candidate) => candidate.sessionId !== sessionId),
        adding: withoutKey(state.adding, sessionId),
        loaded: true,
      }))
    } catch (error) {
      set((state) => ({
        adding: withoutKey(state.adding, sessionId),
        searchError: errorMessage(error, '加入全局会话失败'),
      }))
    }
  },

  remove: async (sessionId) => {
    set((state) => ({ removing: { ...state.removing, [sessionId]: true }, error: null }))
    try {
      await wsClient.request({ type: 'sessionDock.remove', sessionId })
      set((state) => ({
        items: state.items.filter((item) => item.sessionId !== sessionId),
        removing: withoutKey(state.removing, sessionId),
      }))
    } catch (error) {
      set((state) => ({
        removing: withoutKey(state.removing, sessionId),
        error: errorMessage(error, '移除全局会话失败'),
      }))
    }
  },

  reorder: async (sessionIds) => {
    const previous = get().items
    const byId = new Map(previous.map((item) => [item.sessionId, item]))
    const optimistic = sessionIds.flatMap((sessionId, index) => {
      const item = byId.get(sessionId)
      return item ? [{ ...item, sortOrder: index + 1 }] : []
    })
    if (optimistic.length !== previous.length) return
    set({ items: optimistic, reordering: true, error: null })
    try {
      const items = await wsClient.request({ type: 'sessionDock.reorder', sessionIds }) as SessionDockItem[]
      set({ items, reordering: false })
    } catch (error) {
      set({ items: previous, reordering: false, error: errorMessage(error, '会话排序保存失败') })
    }
  },

  setupListeners: () => {
    const refresh = (): void => { void get().load({ silent: true }) }
    const refreshSession = (message: Record<string, unknown>): void => {
      if (typeof message.sessionId !== 'string') return
      if (get().items.some((item) => item.sessionId === message.sessionId)) refresh()
    }
    const unsubscribers = [
      wsClient.on('session-dock:update', refresh),
      wsClient.on('session:activity', refreshSession),
      wsClient.on('session:done', refreshSession),
      wsClient.on('session:changed', refreshSession),
      wsClient.on('reconnected', refresh),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  },
}))

function sortDockItems(items: SessionDockItem[]): SessionDockItem[] {
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
