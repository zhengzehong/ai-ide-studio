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

export interface ClaudeProfileConfig {
  defaultModel: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

export interface CodexProfileConfig {
  model: string
  effort?: string
}

export type ModelProfileConfig = ClaudeProfileConfig | CodexProfileConfig

export interface ModelProfileData {
  id: string
  name: string
  runtime: 'claude' | 'codex'
  provider_id: string
  config_json: string
  context_window: number | null
  enabled: number
  created_at: string
  updated_at: string
}

interface ModelStore {
  providers: ModelProviderData[]
  profiles: ModelProfileData[]
  loading: boolean
  fetchProviders: () => void
  fetchProfiles: (runtime?: 'claude' | 'codex') => void
  createProvider: (p: { name: string; displayName: string; protocol: string; baseUrl: string; apiKey: string; models?: { id: string; name: string }[] }) => Promise<void>
  updateProvider: (id: string, fields: Record<string, unknown>) => Promise<void>
  toggleProvider: (id: string, enabled: boolean) => void
  deleteProvider: (id: string) => void
  setDefault: (id: string) => void
  testProvider: (id: string) => Promise<{ ok: boolean; models?: string[]; error?: string }>
  createProfile: (p: { name: string; runtime: 'claude' | 'codex'; providerId: string; contextWindow?: number | null; config: ModelProfileConfig }) => Promise<void>
  updateProfile: (id: string, fields: Record<string, unknown>) => Promise<void>
  toggleProfile: (id: string, enabled: boolean) => void
  deleteProfile: (id: string) => void
}

export const useModelStore = create<ModelStore>((set, get) => ({
  providers: [],
  profiles: [],
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

  fetchProfiles: async (runtime) => {
    const payload: Record<string, unknown> = {}
    if (runtime) payload.runtime = runtime
    const data = await wsRpc('modelProfiles.list', payload) as ModelProfileData[]
    set({ profiles: data })
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

  createProfile: async (p) => {
    await wsRpc('modelProfiles.create', p)
    get().fetchProfiles()
  },

  updateProfile: async (id, fields) => {
    await wsRpc('modelProfiles.update', { profileId: id, ...fields })
    get().fetchProfiles()
  },

  toggleProfile: async (id, enabled) => {
    await wsRpc('modelProfiles.toggle', { profileId: id, enabled })
    get().fetchProfiles()
  },

  deleteProfile: async (id) => {
    await wsRpc('modelProfiles.delete', { profileId: id })
    get().fetchProfiles()
  },
}))
