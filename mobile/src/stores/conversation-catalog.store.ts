import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'
import type { MobileConversationCatalog } from '../../../src/shared/mobile-conversations'
import { useConnectionStore } from './connection.store'

const emptyCatalog: MobileConversationCatalog = { teams: [], conversations: [], hiddenAgentIds: [], hiddenSessionIds: [] }
interface CatalogState {
  catalog: MobileConversationCatalog
  loaded: boolean
  error: string | null
  activeConversationId: string | null
  epoch: number
  setActiveConversation: (id: string | null) => void
  load: () => Promise<void>
  setupListeners: () => () => void
}
let inflight: Promise<void> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let dirty = false

export const useConversationCatalog = create<CatalogState>((set, get) => ({
  catalog: emptyCatalog, loaded: false, error: null, activeConversationId: null, epoch: 0,
  setActiveConversation: activeConversationId => set({ activeConversationId }),
  load: () => {
    if (inflight) { dirty = true; return inflight }
    const epoch = get().epoch
    const request = wsClient.request({ type: 'mobile.conversations.list' }).then(data => {
      if (get().epoch === epoch) set({ catalog: data as MobileConversationCatalog, loaded: true, error: null })
    }).catch((error: unknown) => {
      if (get().epoch === epoch) set({ error: error instanceof Error ? error.message : '团队会话加载失败' })
    }).finally(() => {
      if (inflight !== request) return
      inflight = null
      if (dirty) { dirty = false; return get().load() }
    })
    inflight = request
    return inflight
  },
  setupListeners: () => {
    const schedule = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => { refreshTimer = null; void get().load() }, 250)
    }
    const resume = (): void => { if (document.visibilityState === 'visible') schedule() }
    const off = ['team:update', 'session:activity', 'session:done', 'session:changed', 'reconnected']
      .map(event => wsClient.on(event, schedule))
    document.addEventListener('visibilitychange', resume)
    return () => {
      off.forEach(unsubscribe => unsubscribe())
      document.removeEventListener('visibilitychange', resume)
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = null
    }
  },
}))

useConnectionStore.subscribe((state, previous) => {
  if (state.serverUrl === previous.serverUrl && state.token === previous.token) return
  inflight = null
  dirty = false
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  useConversationCatalog.setState(current => ({ catalog: emptyCatalog, loaded: false, error: null, activeConversationId: null, epoch: current.epoch + 1 }))
})
