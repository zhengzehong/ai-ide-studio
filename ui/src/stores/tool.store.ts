import { create } from 'zustand'

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

interface ToolStore {
  tools: ToolData[]
  bindings: ToolBindingData[]
  loading: boolean

  fetchTools: () => void
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
  }) => void
  updateTool: (toolId: string, fields: Record<string, unknown>) => void
  toggleTool: (toolId: string, enabled: boolean) => void
  deleteTool: (toolId: string) => void

  setBinding: (toolId: string, scope: string, targetId?: string, configOverride?: object) => void
  removeBinding: (toolId: string, scope: string, targetId?: string) => void

  getBindingsForTool: (toolId: string) => ToolBindingData[]
  isToolBound: (toolId: string, scope: string, targetId?: string) => boolean
}

let _ws: WebSocket | null = null
let _nextId = 1
const _pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function getWs(): WebSocket | null {
  return _ws
}

function rpc(type: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = getWs()
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket 未连接'))
      return
    }
    const requestId = _nextId++
    _pending.set(requestId, { resolve, reject })
    ws.send(JSON.stringify({ type, requestId, ...params }))
  })
}

export function initToolStoreWs(ws: WebSocket) {
  _ws = ws
  const origHandler = ws.onmessage
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string)
      if (msg.requestId && _pending.has(msg.requestId)) {
        const p = _pending.get(msg.requestId)!
        _pending.delete(msg.requestId)
        if (msg.type === 'error') p.reject(new Error(msg.error))
        else p.resolve(msg.data ?? msg)
        return
      }
    } catch { /* not json */ }
    if (origHandler) (origHandler as (ev: MessageEvent) => void)(ev)
  }
}

export const useToolStore = create<ToolStore>((set, get) => ({
  tools: [],
  bindings: [],
  loading: false,

  fetchTools: async () => {
    set({ loading: true })
    try {
      const result = await rpc('tools.list') as { tools: ToolData[]; bindings: ToolBindingData[] }
      set({ tools: result.tools, bindings: result.bindings, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createTool: async (params) => {
    try {
      await rpc('tools.create', params)
      get().fetchTools()
    } catch (e) {
      console.error('创建工具失败', e)
    }
  },

  updateTool: async (toolId, fields) => {
    try {
      await rpc('tools.update', { toolId, ...fields })
      get().fetchTools()
    } catch (e) {
      console.error('更新工具失败', e)
    }
  },

  toggleTool: async (toolId, enabled) => {
    try {
      await rpc('tools.toggle', { toolId, enabled })
      get().fetchTools()
    } catch (e) {
      console.error('切换工具状态失败', e)
    }
  },

  deleteTool: async (toolId) => {
    try {
      await rpc('tools.delete', { toolId })
      get().fetchTools()
    } catch (e) {
      console.error('删除工具失败', e)
    }
  },

  setBinding: async (toolId, scope, targetId, configOverride) => {
    try {
      await rpc('tool-bindings.set', { toolId, scope, targetId, configOverride })
      get().fetchTools()
    } catch (e) {
      console.error('设置绑定失败', e)
    }
  },

  removeBinding: async (toolId, scope, targetId) => {
    try {
      await rpc('tool-bindings.remove', { toolId, scope, targetId })
      get().fetchTools()
    } catch (e) {
      console.error('移除绑定失败', e)
    }
  },

  getBindingsForTool: (toolId) => {
    return get().bindings.filter(b => b.tool_id === toolId)
  },

  isToolBound: (toolId, scope, targetId) => {
    return get().bindings.some(b =>
      b.tool_id === toolId && b.scope === scope &&
      (targetId ? b.target_id === targetId : !b.target_id) && b.enabled,
    )
  },
}))
