import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface ToolData {
  id: string
  name: string
  display_name: string
  description: string
  category: string
  type: string
  config_json: string
  input_schema_json: string | null
  permissions_json: string
  enabled: number
  is_builtin: number
  created_at: string
  updated_at: string
}

export interface ToolBindingData {
  id: string
  tool_id: string
  scope: string
  target_id: string | null
  enabled: number
  config_override_json: string | null
  created_at: string
}

export interface ToolProfileData {
  id: string
  name: string
  description: string
  toolNames: string[]
}

interface ToolStore {
  tools: ToolData[]
  bindings: ToolBindingData[]
  profiles: ToolProfileData[]
  loading: boolean

  fetchTools: () => Promise<void>
  fetchProfiles: () => Promise<void>
  createTool: (params: {
    name: string
    displayName: string
    description: string
    category: string
    toolType: string
    config: object
    inputSchema?: object
    permissions?: object
    defaultScope?: string
    targetId?: string
  }) => Promise<void>
  updateTool: (toolId: string, fields: Record<string, unknown>) => Promise<void>
  toggleTool: (toolId: string, enabled: boolean) => Promise<void>
  deleteTool: (toolId: string) => Promise<void>

  setBinding: (
    toolId: string,
    scope: string,
    targetId?: string,
    configOverride?: object,
    enabled?: boolean,
  ) => Promise<void>
  removeBinding: (toolId: string, scope: string, targetId?: string) => Promise<void>
  applyProfile: (profileId: string, agentId: string) => Promise<void>

  getBindingsForTool: (toolId: string) => ToolBindingData[]
  isToolBound: (toolId: string, scope: string, targetId?: string) => boolean
}

export const useToolStore = create<ToolStore>((set, get) => ({
  tools: [],
  bindings: [],
  profiles: [],
  loading: false,

  fetchTools: async () => {
    set({ loading: true })
    try {
      const result = (await wsClient.request({ type: 'tools.list' })) as {
        tools: ToolData[]
        bindings: ToolBindingData[]
      }
      set({ tools: result.tools, bindings: result.bindings, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchProfiles: async () => {
    const result = (await wsClient.request({ type: 'tool-profiles.list' })) as { profiles: ToolProfileData[] }
    set({ profiles: result.profiles })
  },

  createTool: async (params) => {
    await wsClient.request({ type: 'tools.create', ...params })
    await get().fetchTools()
  },

  updateTool: async (toolId, fields) => {
    await wsClient.request({ type: 'tools.update', toolId, ...fields })
    await get().fetchTools()
  },

  toggleTool: async (toolId, enabled) => {
    await wsClient.request({ type: 'tools.toggle', toolId, enabled })
    await get().fetchTools()
  },

  deleteTool: async (toolId) => {
    await wsClient.request({ type: 'tools.delete', toolId })
    await get().fetchTools()
  },

  setBinding: async (toolId, scope, targetId, configOverride, enabled = true) => {
    await wsClient.request({ type: 'tool-bindings.set', toolId, scope, targetId, configOverride, enabled })
    await get().fetchTools()
  },

  removeBinding: async (toolId, scope, targetId) => {
    await wsClient.request({ type: 'tool-bindings.remove', toolId, scope, targetId })
    await get().fetchTools()
  },

  applyProfile: async (profileId, agentId) => {
    await wsClient.request({ type: 'tool-profiles.apply', profileId, agentId })
    await get().fetchTools()
  },

  getBindingsForTool: (toolId) => {
    return get().bindings.filter((b) => b.tool_id === toolId)
  },

  isToolBound: (toolId, scope, targetId) => {
    return get().bindings.some(
      (b) =>
        b.tool_id === toolId && b.scope === scope && (targetId ? b.target_id === targetId : !b.target_id) && b.enabled,
    )
  },
}))
