import { create } from 'zustand'
import {
  getReadingItem,
  listReadingItems,
  updateReadingStatus,
} from '../services/reading-client'
import type { ReadingItem, ReadingListFilter, ReadingProjectCount } from '../types/reading'

interface ReadingStore {
  items: ReadingItem[]
  unreadCount: number
  projectCounts: ReadingProjectCount[]
  loading: boolean
  error: string | null
  load: (filter?: ReadingListFilter, options?: { silent?: boolean }) => Promise<void>
  refreshUnreadCount: () => Promise<void>
  get: (readingId: string) => Promise<ReadingItem>
  updateStatus: (readingId: string, status: 'read' | 'archived') => Promise<ReadingItem>
}

let loadGeneration = 0
let lastFilter: ReadingListFilter = {}

export const useReadingStore = create<ReadingStore>((set, get) => ({
  items: [],
  unreadCount: 0,
  projectCounts: [],
  loading: false,
  error: null,

  load: async (filter = {}, options = {}) => {
    const generation = ++loadGeneration
    lastFilter = filter
    if (!options.silent) set({ loading: true, error: null })
    try {
      const result = await listReadingItems(filter)
      if (generation !== loadGeneration) return
      set({
        items: result.items,
        unreadCount: result.unreadCount,
        projectCounts: result.projectCounts,
        loading: false,
        error: null,
      })
    } catch (error) {
      if (generation !== loadGeneration) return
      set({ loading: false, error: error instanceof Error ? error.message : '阅读列表加载失败' })
    }
  },

  refreshUnreadCount: async () => {
    try {
      const result = await listReadingItems({ limit: 1 })
      set({ unreadCount: result.unreadCount })
    } catch {
      // The global badge is best-effort while the connection is unavailable.
    }
  },

  get: async (readingId) => await getReadingItem(readingId),

  updateStatus: async (readingId, status) => {
    const updated = await updateReadingStatus(readingId, status)
    set((state) => ({
      items: state.items.map((item) => item.id === readingId ? updated : item),
      unreadCount: state.unreadCount - (state.items.some((item) => item.id === readingId && item.status === 'unread') ? 1 : 0),
    }))
    await get().load(lastFilter, { silent: true })
    return updated
  },
}))
