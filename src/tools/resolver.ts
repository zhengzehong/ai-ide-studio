import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { toolStore, toolBindingStore } from '../store/tools.js'
import { createChildLogger } from '../core/logger.js'
import type { ToolConfig, ResolvedTool, ToolDefinition, ToolBinding, ToolPermissions } from './types.js'

const log = createChildLogger('tool-resolver')
const TOOL_GATEWAY_NAME = 'ai-ide-tool-gateway'

function rowToDefinition(row: ReturnType<typeof toolStore.get>): ToolDefinition | null {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    category: row.category as ToolDefinition['category'],
    type: row.type as ToolDefinition['type'],
    config: JSON.parse(row.config_json) as ToolConfig,
    inputSchema: row.input_schema_json ? JSON.parse(row.input_schema_json) as object : undefined,
    permissions: JSON.parse(row.permissions_json) as ToolPermissions,
    enabled: row.enabled === 1,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToBinding(row: ReturnType<typeof toolBindingStore.list>[0]): ToolBinding {
  return {
    id: row.id,
    toolId: row.tool_id,
    scope: row.scope as ToolBinding['scope'],
    targetId: row.target_id,
    enabled: row.enabled === 1,
    configOverride: row.config_override_json ? JSON.parse(row.config_override_json) : undefined,
    createdAt: row.created_at,
  }
}

export function resolveToolsForSession(agentId?: string, projectId?: string): ResolvedTool[] {
  const allTools = toolStore.list().filter(t => t.enabled)
  const allBindings = toolBindingStore.list()
  const toolMap = new Map<string, ResolvedTool>()

  for (const toolRow of allTools) {
    const def = rowToDefinition(toolRow)
    if (!def) continue

    const bindings = allBindings.filter(b => b.tool_id === def.id && b.enabled)
    const globalBinding = bindings.find(b => b.scope === 'global' && !b.target_id)
    const projectBinding = projectId ? bindings.find(b => b.scope === 'project' && b.target_id === projectId) : undefined
    const agentBinding = agentId ? bindings.find(b => b.scope === 'agent' && b.target_id === agentId) : undefined
    const effectiveBinding = agentBinding || projectBinding || globalBinding

    if (!effectiveBinding) continue

    const binding = rowToBinding(effectiveBinding)
    const effectiveConfig = binding.configOverride
      ? ({ ...def.config, ...binding.configOverride } as ToolConfig)
      : def.config

    toolMap.set(def.id, { definition: def, binding, effectiveConfig })
  }

  const resolved = Array.from(toolMap.values())
  log.debug({ agentId, projectId, count: resolved.length }, 'resolved available tools')
  return resolved
}

function envObjectToArray(env?: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(env ?? {}).map(([name, value]) => ({ name, value }))
}

export function resolveToolsAsMcpServers(agentId?: string, projectId?: string): Array<{
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}> {
  const tools = resolveToolsForSession(agentId, projectId)
  const mcpServers: Array<{
    name: string
    command: string
    args: string[]
    env: Array<{ name: string; value: string }>
  }> = []
  const gatewayToolIds: string[] = []

  for (const tool of tools) {
    if (tool.definition.type === 'mcp') {
      const config = tool.effectiveConfig as { command: string; args: string[]; env?: Record<string, string> }
      mcpServers.push({
        name: tool.definition.name,
        command: config.command,
        args: config.args,
        env: envObjectToArray(config.env),
      })
    } else {
      gatewayToolIds.push(tool.definition.id)
    }
  }

  if (gatewayToolIds.length > 0) {
    mcpServers.push({
      name: TOOL_GATEWAY_NAME,
      command: process.execPath,
      args: resolveToolGatewayArgs(),
      env: [
        { name: 'TOOL_IDS', value: gatewayToolIds.join(',') },
        { name: 'PROJECT_ID', value: projectId ?? '' },
        { name: 'AGENT_ID', value: agentId ?? '' },
        { name: 'DATA_DIR', value: process.env.DATA_DIR ?? './data' },
      ],
    })
  }

  log.info({ agentId, projectId, mcpCount: mcpServers.length, gatewayCount: gatewayToolIds.length }, 'generated MCP server config')
  return mcpServers
}

function resolveToolGatewayArgs(): string[] {
  const distEntry = resolve(process.cwd(), 'dist/tools/tool-gateway.js')
  if (existsSync(distEntry)) return [distEntry]
  return ['--import', 'tsx', resolve(process.cwd(), 'src/tools/tool-gateway.ts')]
}
