import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export const PROJECT_SESSION_STATS_DEBOUNCE_MS = 300
export const PROJECT_SESSION_STATS_STALE_MS = 30_000

export interface ProjectSessionStatsData {
  projectId: string
  runningCount: number
  unreadCount: number
}

interface ProjectSessionStatsSnapshot {
  generatedAt: string
  items: ProjectSessionStatsData[]
}

interface ProjectSessionStatsStore {
  statsByProjectId: Record<string, ProjectSessionStatsData>
  initialized: boolean
  loading: boolean
  refreshing: boolean
  error: string | null
  fetchedAt: number | null
  requestSeq: number
  fetchStats: (options?: { force?: boolean }) => Promise<void>
  refreshIfStale: (maxAgeMs?: number) => Promise<void>
  setupListeners: () => () => void
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null
let staleRefreshTimer: ReturnType<typeof setInterval> | null = null

export const useProjectSessionStatsStore = create<ProjectSessionStatsStore>((set, get) => ({
  statsByProjectId: {},
  initialized: false,
  loading: false,
  refreshing: false,
  error: null,
  fetchedAt: null,
  requestSeq: 0,

  fetchStats: async (options) => {
    const current = get()
    if (!options?.force && (current.loading || current.refreshing)) return
    const requestSeq = current.requestSeq + 1
    set({
      requestSeq,
      loading: !current.initialized,
      refreshing: current.initialized,
      error: null,
    })

    try {
      const snapshot = (await wsClient.request({ type: 'sessions.projectStats' })) as ProjectSessionStatsSnapshot
      if (get().requestSeq !== requestSeq) return
      const statsByProjectId = Object.fromEntries(
        snapshot.items.map((stats) => [stats.projectId, stats]),
      )
      set({
        statsByProjectId,
        initialized: true,
        loading: false,
        refreshing: false,
        error: null,
        fetchedAt: Date.now(),
      })
    } catch (error) {
      if (get().requestSeq !== requestSeq) return
      set({
        initialized: true,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : '项目会话统计加载失败',
      })
    }
  },

  refreshIfStale: async (maxAgeMs = PROJECT_SESSION_STATS_STALE_MS) => {
    const state = get()
    if (
      state.loading ||
      state.refreshing ||
      (state.fetchedAt !== null && Date.now() - state.fetchedAt < maxAgeMs)
    ) return
    await state.fetchStats()
  },

  setupListeners: () => {
    const scheduleRefresh = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void get().fetchStats({ force: true })
      }, PROJECT_SESSION_STATS_DEBOUNCE_MS)
    }
    const offActivity = wsClient.on('session:activity', scheduleRefresh)
    const offChanged = wsClient.on('session:changed', scheduleRefresh)
    const recoverVisibleStats = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void get().refreshIfStale(0)
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') recoverVisibleStats()
    }
    staleRefreshTimer = setInterval(() => {
      void get().refreshIfStale()
    }, PROJECT_SESSION_STATS_STALE_MS)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', recoverVisibleStats)
    }
    return () => {
      offActivity()
      offChanged()
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
      if (staleRefreshTimer) {
        clearInterval(staleRefreshTimer)
        staleRefreshTimer = null
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', recoverVisibleStats)
      }
    }
  },
}))
