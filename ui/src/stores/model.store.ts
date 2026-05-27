import { create } from 'zustand'
import { wsRpc } from '../services/ws'

export interface ModelProviderData {
  id: string
  name: string
  display_name: string
  protocol: string
  base_url: string
  api_key: string
  models_json: string
  is_default: number
  enabled: number
  created_at: string
  updated_at: string
}

interface ModelStore {
  providers: ModelProviderData[]
  loading: boolean
  fetchProviders: () => void
  createProvider: (p: { name: string; displayName: string; protocol: string; baseUrl: string; apiKey: string; models?: { id: string; name: string }[] }) => Promise<void>
  updateProvider: (id: string, fields: Record<string, unknown>) => Promise<void>
  toggleProvider: (id: string, enabled: boolean) => void
  deleteProvider: (id: string) => void
  setDefault: (id: string) => void
  testProvider: (id: string) => Promise<{ ok: boolean; models?: string[]; error?: string }>
}

export const useModelStore = create<ModelStore>((set, get) => ({
  providers: [],
  loading: false,

  fetchProviders: async () => {
    set({ loading: true })
    try {
      const data = await wsRpc('models.list') as ModelProviderData[]
      set({ providers: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createProvider: async (p) => {
    await wsRpc('models.create', p)
    get().fetchProviders()
  },

  updateProvider: async (id, fields) => {
    await wsRpc('models.update', { providerId: id, ...fields })
    get().fetchProviders()
  },

  toggleProvider: async (id, enabled) => {
    await wsRpc('models.toggle', { providerId: id, enabled })
    get().fetchProviders()
  },

  deleteProvider: async (id) => {
    await wsRpc('models.delete', { providerId: id })
    get().fetchProviders()
  },

  setDefault: async (id) => {
    await wsRpc('models.setDefault', { providerId: id })
    get().fetchProviders()
  },

  testProvider: async (id) => {
    return await wsRpc('models.test', { providerId: id }) as { ok: boolean; models?: string[]; error?: string }
  },
}))
