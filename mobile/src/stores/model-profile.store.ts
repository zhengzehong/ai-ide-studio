import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'
import { useAppStore } from './app.store'

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

export type ModelProfileRuntime = 'claude' | 'codex'
export type AgentProfileMode = 'global' | 'fixed' | 'system'

interface ModelProfileState {
  profiles: ModelProfileData[]
  globalProfiles: Record<ModelProfileRuntime, GlobalModelProfileData | null>
  loading: boolean
  error: string | null
  fetchAll: () => Promise<void>
  setGlobalProfile: (runtime: ModelProfileRuntime, profileId: string) => Promise<void>
  clearGlobalProfile: (runtime: ModelProfileRuntime) => Promise<void>
  updateAgentProfile: (agentId: string, mode: AgentProfileMode, profileId: string | null) => Promise<void>
}

const emptyGlobals: Record<ModelProfileRuntime, GlobalModelProfileData | null> = {
  claude: null,
  codex: null,
}

export const useModelProfileStore = create<ModelProfileState>((set) => ({
  profiles: [],
  globalProfiles: emptyGlobals,
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true })
    try {
      const [profiles, claude, codex] = await Promise.all([
        wsClient.request({ type: 'modelProfiles.list' }) as Promise<ModelProfileData[]>,
        wsClient.request({ type: 'modelProfiles.global.get', runtime: 'claude' }) as Promise<GlobalModelProfileData>,
        wsClient.request({ type: 'modelProfiles.global.get', runtime: 'codex' }) as Promise<GlobalModelProfileData>,
      ])
      set({ profiles, globalProfiles: { claude, codex }, loading: false, error: null })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '模型档案读取失败' })
    }
  },

  setGlobalProfile: async (runtime, profileId) => {
    const data = await wsClient.request({
      type: 'modelProfiles.global.set',
      runtime,
      profileId,
    }) as GlobalModelProfileData
    set((state) => ({ globalProfiles: { ...state.globalProfiles, [runtime]: data } }))
  },

  clearGlobalProfile: async (runtime) => {
    const data = await wsClient.request({
      type: 'modelProfiles.global.clear',
      runtime,
    }) as GlobalModelProfileData
    set((state) => ({ globalProfiles: { ...state.globalProfiles, [runtime]: data } }))
  },

  updateAgentProfile: async (agentId, mode, profileId) => {
    await wsClient.request({
      type: 'agents.update',
      agentId,
      modelProfileMode: mode,
      modelProfileId: profileId,
    })
    // Agent 实体变了,刷新当前项目的 Agent 列表(分组头/别处显示的模式保持一致)
    const app = useAppStore.getState()
    await app.fetchAgents(app.currentProjectId ?? undefined)
  },
}))
