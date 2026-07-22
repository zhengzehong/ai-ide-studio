import { create } from 'zustand'
import type {
  ProjectSessionStatsData,
  ProjectSessionStatsSnapshotData,
} from '../../../src/types/ws-protocol'
import { wsClient } from '@desktop/services/ws-client'

export const MOBILE_PROJECT_SESSION_STATS_DEBOUNCE_MS = 300

interface MobileProjectSessionStatsStore {
  statsByProjectId: Record<string, ProjectSessionStatsData>
  initialized: boolean
  loading: boolean
  refreshing: boolean
  error: string | null
  requestSeq: number
  fetchStats: (options?: { force?: boolean }) => Promise<void>
  setupListeners: () => () => void
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useMobileProjectSessionStatsStore = create<MobileProjectSessionStatsStore>((set, get) => ({
  statsByProjectId: {},
  initialized: false,
  loading: false,
  refreshing: false,
  error: null,
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
      const snapshot = (await wsClient.request({
        type: 'sessions.projectStats',
      })) as ProjectSessionStatsSnapshotData
      if (get().requestSeq !== requestSeq) return
      set({
        statsByProjectId: Object.fromEntries(
          snapshot.items.map((stats) => [stats.projectId, stats]),
        ),
        initialized: true,
        loading: false,
        refreshing: false,
        error: null,
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

  setupListeners: () => {
    const scheduleRefresh = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void get().fetchStats({ force: true })
      }, MOBILE_PROJECT_SESSION_STATS_DEBOUNCE_MS)
    }
    const offActivity = wsClient.on('session:activity', scheduleRefresh)
    const offChanged = wsClient.on('session:changed', scheduleRefresh)
    const offDone = wsClient.on('session:done', scheduleRefresh)
    return () => {
      offActivity()
      offChanged()
      offDone()
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
    }
  },
}))
