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
  allowImageRead?: boolean
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
  is_default: number
  enabled: number
  created_at: string
  updated_at: string
}

export interface GlobalModelProfileData {
  runtime: 'claude' | 'codex'
  enabled: boolean
  profileId: string | null
  profile: ModelProfileData | null
}

interface ModelStore {
  providers: ModelProviderData[]
  profiles: ModelProfileData[]
  globalProfiles: Record<'claude' | 'codex', GlobalModelProfileData>
  loading: boolean
  fetchProviders: () => Promise<void>
  fetchProfiles: (runtime?: 'claude' | 'codex') => Promise<void>
  fetchGlobalProfiles: () => Promise<void>
  createProvider: (p: { name: string; displayName: string; protocol: string; baseUrl: string; apiKey: string; models?: { id: string; name: string }[] }) => Promise<void>
  updateProvider: (id: string, fields: Record<string, unknown>) => Promise<void>
  toggleProvider: (id: string, enabled: boolean) => void
  deleteProvider: (id: string) => void
  setDefault: (id: string) => void
  testProvider: (id: string) => Promise<{ ok: boolean; models?: string[]; error?: string }>
  createProfile: (p: { name: string; runtime: 'claude' | 'codex'; providerId: string; contextWindow?: number | null; config: ModelProfileConfig }) => Promise<void>
  updateProfile: (id: string, fields: Record<string, unknown>) => Promise<void>
  toggleProfile: (id: string, enabled: boolean) => void
  setDefaultProfile: (id: string) => void
  deleteProfile: (id: string) => void
  setGlobalProfile: (runtime: 'claude' | 'codex', profileId: string) => Promise<void>
  clearGlobalProfile: (runtime: 'claude' | 'codex') => Promise<void>
  bulkSetAgentModelProfileMode: (runtime: 'claude' | 'codex', mode: 'global' | 'system') => Promise<number>
}

const emptyGlobalProfile = (runtime: 'claude' | 'codex'): GlobalModelProfileData => ({
  runtime,
  enabled: false,
  profileId: null,
  profile: null,
})

export const useModelStore = create<ModelStore>((set, get) => ({
  providers: [],
  profiles: [],
  globalProfiles: { claude: emptyGlobalProfile('claude'), codex: emptyGlobalProfile('codex') },
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

  fetchGlobalProfiles: async () => {
    const [claude, codex] = await Promise.all([
      wsRpc('modelProfiles.global.get', { runtime: 'claude' }) as Promise<GlobalModelProfileData>,
      wsRpc('modelProfiles.global.get', { runtime: 'codex' }) as Promise<GlobalModelProfileData>,
    ])
    set({ globalProfiles: { claude, codex } })
  },

  createProvider: async (p) => {
    await wsRpc('models.create', p)
    get().fetchProviders()
  },

  updateProvider: async (id, fields) => {
    await wsRpc('models.update', { providerId: id, ...fields })
    await Promise.all([get().fetchProviders(), get().fetchGlobalProfiles()])
  },

  toggleProvider: async (id, enabled) => {
    await wsRpc('models.toggle', { providerId: id, enabled })
    await Promise.all([get().fetchProviders(), get().fetchGlobalProfiles()])
  },

  deleteProvider: async (id) => {
    await wsRpc('models.delete', { providerId: id })
    await Promise.all([get().fetchProviders(), get().fetchGlobalProfiles()])
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
    await Promise.all([get().fetchProfiles(), get().fetchGlobalProfiles()])
  },

  toggleProfile: async (id, enabled) => {
    await wsRpc('modelProfiles.toggle', { profileId: id, enabled })
    await Promise.all([get().fetchProfiles(), get().fetchGlobalProfiles()])
  },

  setDefaultProfile: async (id) => {
    await wsRpc('modelProfiles.setDefault', { profileId: id })
    get().fetchProfiles()
  },

  deleteProfile: async (id) => {
    await wsRpc('modelProfiles.delete', { profileId: id })
    await Promise.all([get().fetchProfiles(), get().fetchGlobalProfiles()])
  },

  setGlobalProfile: async (runtime, profileId) => {
    const data = await wsRpc('modelProfiles.global.set', { runtime, profileId }) as GlobalModelProfileData
    set((state) => ({ globalProfiles: { ...state.globalProfiles, [runtime]: data } }))
  },

  clearGlobalProfile: async (runtime) => {
    const data = await wsRpc('modelProfiles.global.clear', { runtime }) as GlobalModelProfileData
    set((state) => ({ globalProfiles: { ...state.globalProfiles, [runtime]: data } }))
  },

  bulkSetAgentModelProfileMode: async (runtime, mode) => {
    const result = await wsRpc('agents.bulkModelProfileMode', { runtime, mode }) as { count: number }
    return result.count
  },
}))
