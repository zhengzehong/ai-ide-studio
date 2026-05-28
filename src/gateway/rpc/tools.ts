import type { ToolConfig } from '../../tools/types.js'
import { toolBindingStore, toolStore } from '../../store/tools.js'
import type { RpcHandlerMap } from './types.js'

type ToolCategory = 'browser' | 'filesystem' | 'network' | 'automation' | 'code' | 'data' | 'custom'
type ToolType = 'builtin' | 'mcp' | 'script'
type ToolScope = 'global' | 'project' | 'agent'

type ToolPermissions = { requiresApproval: boolean; maxExecutionTime: number; networkAccess: boolean }

export const toolRpcHandlers: RpcHandlerMap = {
  'tools.list'(_msg, { sendResult }) {
    sendResult({ tools: toolStore.list(), bindings: toolBindingStore.list() })
  },

  'tools.get'(msg, { sendResult }) {
    const tool = toolStore.get(msg.toolId as string)
    if (!tool) throw new Error('工具不存在')
    sendResult({ tool, bindings: toolBindingStore.list(tool.id) })
  },

  'tools.create'(msg, { sendResult }) {
    const tool = toolStore.create({
      name: msg.name as string,
      displayName: msg.displayName as string,
      description: msg.description as string,
      category: msg.category as ToolCategory,
      type: msg.toolType as ToolType,
      config: msg.config as ToolConfig,
      inputSchema: msg.inputSchema as object | undefined,
      permissions: msg.permissions as ToolPermissions | undefined,
    })
    if (msg.defaultScope) {
      toolBindingStore.set(tool.id, msg.defaultScope as ToolScope, msg.targetId as string ?? null)
    }
    sendResult(tool)
  },

  'tools.update'(msg, { sendResult }) {
    const updated = toolStore.update(msg.toolId as string, {
      displayName: msg.displayName as string | undefined,
      description: msg.description as string | undefined,
      category: msg.category as ToolCategory | undefined,
      type: msg.toolType as ToolType | undefined,
      config: msg.config as ToolConfig | undefined,
      inputSchema: msg.inputSchema as object | undefined,
      permissions: msg.permissions as ToolPermissions | undefined,
    })
    if (!updated) throw new Error('工具不存在')
    sendResult(updated)
  },

  'tools.toggle'(msg, { sendResult }) {
    toolStore.toggle(msg.toolId as string, msg.enabled as boolean)
    sendResult({ ok: true })
  },

  'tools.delete'(msg, { sendResult }) {
    const tool = toolStore.get(msg.toolId as string)
    if (!tool) throw new Error('工具不存在')
    if (tool.is_builtin) throw new Error('不能删除内置工具')
    toolStore.delete(msg.toolId as string)
    sendResult({ ok: true })
  },

  'tool-bindings.set'(msg, { sendResult }) {
    sendResult(toolBindingStore.set(
      msg.toolId as string,
      msg.scope as ToolScope,
      msg.targetId as string ?? null,
      msg.configOverride as Record<string, unknown> | undefined,
    ))
  },

  'tool-bindings.remove'(msg, { sendResult }) {
    toolBindingStore.remove(msg.toolId as string, msg.scope as ToolScope, msg.targetId as string ?? null)
    sendResult({ ok: true })
  },
}
