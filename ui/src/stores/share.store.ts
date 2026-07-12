import { create } from 'zustand'
import {
  bootstrapShare,
  recordShareVisit,
  createShare as apiCreateShare,
  listShares as apiListShares,
  revokeShare as apiRevokeShare,
  renewShare as apiRenewShare,
  deleteShare as apiDeleteShare,
  type CreateShareInput,
  type ShareBootstrapResult,
  type ShareRow,
} from '../services/share-api'

interface ShareStore {
  currentShare: ShareBootstrapResult | null
  shares: ShareRow[]
  loading: boolean
  error: string | null
  bootstrapByToken: (token: string) => Promise<ShareBootstrapResult | null>
  recordVisit: (token: string) => Promise<void>
  createShare: (input: CreateShareInput) => Promise<ShareRow | null>
  fetchShares: (ownerAgentId: string, sessionId?: string) => Promise<void>
  revokeShare: (id: string) => Promise<ShareRow | null>
  renewShare: (id: string, days: number | null) => Promise<ShareRow | null>
  deleteShare: (id: string) => Promise<boolean>
  clearCurrent: () => void
  clearError: () => void
}

export const useShareStore = create<ShareStore>((set) => ({
  currentShare: null,
  shares: [],
  loading: false,
  error: null,

  bootstrapByToken: async (token) => {
    set({ loading: true, error: null })
    try {
      const result = await bootstrapShare(token)
      set({ currentShare: result, loading: false })
      return result
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '加载分享失败' })
      return null
    }
  },

  recordVisit: async (token) => {
    await recordShareVisit(token)
  },

  createShare: async (input) => {
    set({ loading: true, error: null })
    try {
      const share = await apiCreateShare(input)
      set((s) => ({ shares: [share, ...s.shares], loading: false }))
      return share
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '创建分享失败' })
      return null
    }
  },

  fetchShares: async (ownerAgentId, sessionId) => {
    set({ loading: true, error: null })
    try {
      const list = await apiListShares(ownerAgentId, sessionId)
      set({ shares: list, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '加载分享列表失败' })
    }
  },

  revokeShare: async (id) => {
    set({ loading: true, error: null })
    try {
      const share = await apiRevokeShare(id)
      set((s) => ({
        shares: s.shares.map((item) => (item.id === id ? share : item)),
        loading: false,
      }))
      return share
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '撤销分享失败' })
      return null
    }
  },

  renewShare: async (id, days) => {
    set({ loading: true, error: null })
    try {
      const share = await apiRenewShare(id, days)
      set((s) => ({
        shares: s.shares.map((item) => (item.id === id ? share : item)),
        loading: false,
      }))
      return share
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '续期分享失败' })
      return null
    }
  },

  deleteShare: async (id) => {
    set({ loading: true, error: null })
    try {
      await apiDeleteShare(id)
      set((s) => ({
        shares: s.shares.filter((item) => item.id !== id),
        loading: false,
      }))
      return true
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '删除分享失败' })
      return false
    }
  },

  clearCurrent: () => set({ currentShare: null }),
  clearError: () => set({ error: null }),
}))
