import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { toolStore, toolBindingStore } from '../store/tools.js'
import { createChildLogger } from '../core/logger.js'
import type { ToolConfig, ResolvedTool, ToolDefinition, ToolBinding, ToolPermissions } from './types.js'
import { createToolContext } from './registry/context-registry.js'
import { resolveVisiblePlatformTools } from './registry/visibility-resolver.js'
import { teamMemberStore } from '../store/teams.js'
import { TEAM_LEADER_INITIAL_HIDDEN_TOOLS } from './team-profiles.js'
import type { McpServer } from '@agentclientprotocol/sdk'

const log = createChildLogger('tool-resolver')
const TOOL_GATEWAY_NAME = 'ai-ide-tool-gateway'
const HTTP_TOOL_GATEWAY_NAME = 'ai-ide-tools'

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
    inputSchema: row.input_schema_json ? (JSON.parse(row.input_schema_json) as object) : undefined,
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

export function resolveToolsForSession(agentId?: string, projectId?: string, sessionId?: string): ResolvedTool[] {
  const allBindings = toolBindingStore.list()
  const allTools = toolStore.list().filter((t) => t.enabled)
  const hiddenToolNames = resolveHiddenToolNames({ agentId, projectId, sessionId }, allTools, allBindings)
  const toolMap = new Map<string, ResolvedTool>()

  for (const toolRow of allTools) {
    if (hiddenToolNames.has(toolRow.name)) continue
    const def = rowToDefinition(toolRow)
    if (!def) continue

    const bindings = allBindings.filter((b) => b.tool_id === def.id)
    const globalBinding = bindings.find((b) => b.scope === 'global' && !b.target_id)
    const projectBinding = projectId
      ? bindings.find((b) => b.scope === 'project' && b.target_id === projectId)
      : undefined
    const agentBinding = agentId ? bindings.find((b) => b.scope === 'agent' && b.target_id === agentId) : undefined
    const effectiveBinding = agentBinding || projectBinding || globalBinding

    if (!effectiveBinding || effectiveBinding.enabled !== 1) continue

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

export interface ResolveToolsAsMcpServersOptions {
  agentId?: string
  projectId?: string
  sessionId?: string
  teamId?: string
  teamMemberId?: string
  preferHttp?: boolean
  baseUrl?: string
}

export function resolveToolsAsMcpServers(agentId?: string, projectId?: string): McpServer[]
export function resolveToolsAsMcpServers(options: ResolveToolsAsMcpServersOptions): McpServer[]
export function resolveToolsAsMcpServers(
  agentIdOrOptions?: string | ResolveToolsAsMcpServersOptions,
  projectIdArg?: string,
): McpServer[] {
  const options =
    typeof agentIdOrOptions === 'object' ? agentIdOrOptions : { agentId: agentIdOrOptions, projectId: projectIdArg }
  const { agentId, projectId } = options

  const tools = resolveToolsForSession(agentId, projectId, options.sessionId)
  const teamContext = resolveTeamContext(options)
  const externalServers: McpServer[] = []
  const gatewayToolIds: string[] = []

  for (const tool of tools) {
    if (tool.definition.type === 'mcp') {
      const config = tool.effectiveConfig as { command: string; args: string[]; env?: Record<string, string> }
      externalServers.push({
        name: tool.definition.name,
        command: config.command,
        args: config.args,
        env: envObjectToArray(config.env),
      })
    } else {
      gatewayToolIds.push(tool.definition.id)
    }
  }

  if (options.preferHttp && options.sessionId && gatewayToolIds.length > 0) {
    const visibleTools = resolveVisiblePlatformTools({ agentId, projectId, sessionId: options.sessionId }).map(
      (tool) => tool.definition.name,
    )
    const { token } = createToolContext({
      sessionId: options.sessionId,
      agentId: agentId ?? '',
      projectId,
      teamId: teamContext.teamId,
      teamMemberId: teamContext.teamMemberId,
      visibleTools,
    })
    const baseUrl = (options.baseUrl ?? `http://127.0.0.1:${process.env.PORT ?? '18800'}`).replace(/\/$/, '')
    const httpServer: McpServer = {
      type: 'http',
      name: HTTP_TOOL_GATEWAY_NAME,
      url: `${baseUrl}/mcp`,
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    }
    const mcpServers = [...externalServers, httpServer]
    log.info(
      {
        agentId,
        projectId,
        sessionId: options.sessionId,
        mcpCount: mcpServers.length,
        gatewayCount: visibleTools.length,
        transport: 'http',
      },
      'generated MCP server config',
    )
    return mcpServers
  }

  const mcpServers: McpServer[] = [...externalServers]

  if (gatewayToolIds.length > 0) {
    mcpServers.push({
      name: TOOL_GATEWAY_NAME,
      command: process.execPath,
      args: resolveToolGatewayArgs(),
      env: [
        { name: 'TOOL_IDS', value: gatewayToolIds.join(',') },
        { name: 'SESSION_ID', value: options.sessionId ?? '' },
        { name: 'PROJECT_ID', value: projectId ?? '' },
        { name: 'AGENT_ID', value: agentId ?? '' },
        { name: 'TEAM_ID', value: teamContext.teamId ?? '' },
        { name: 'TEAM_MEMBER_ID', value: teamContext.teamMemberId ?? '' },
        { name: 'DATA_DIR', value: process.env.DATA_DIR ?? './data' },
      ],
    })
  }

  log.info(
    { agentId, projectId, sessionId: options.sessionId, mcpCount: mcpServers.length, gatewayCount: gatewayToolIds.length, transport: 'stdio' },
    'generated MCP server config',
  )
  return mcpServers
}

function resolveHiddenToolNames(
  input: { agentId?: string; projectId?: string; sessionId?: string },
  tools: ReturnType<typeof toolStore.list>,
  bindings: ReturnType<typeof toolBindingStore.list>,
): Set<string> {
  if (input.sessionId) {
    const member = teamMemberStore.getBySession(input.sessionId)
    if (member?.role === 'leader') return new Set(TEAM_LEADER_INITIAL_HIDDEN_TOOLS)
  }
  const leaderTool = tools.find((tool) => tool.name === 'team.member.message')
  if (!leaderTool) return new Set()
  const decision = resolveBindingForTool(leaderTool.id, bindings, input.agentId, input.projectId)
  return decision?.enabled === 1 ? new Set(TEAM_LEADER_INITIAL_HIDDEN_TOOLS) : new Set()
}

function resolveBindingForTool(
  toolId: string,
  bindings: ReturnType<typeof toolBindingStore.list>,
  agentId?: string,
  projectId?: string,
): ReturnType<typeof toolBindingStore.list>[number] | undefined {
  const candidates = bindings.filter((binding) => binding.tool_id === toolId)
  const globalBinding = candidates.find((binding) => binding.scope === 'global' && !binding.target_id)
  const projectBinding = projectId
    ? candidates.find((binding) => binding.scope === 'project' && binding.target_id === projectId)
    : undefined
  const agentBinding = agentId
    ? candidates.find((binding) => binding.scope === 'agent' && binding.target_id === agentId)
    : undefined
  return agentBinding || projectBinding || globalBinding
}

function resolveTeamContext(options: ResolveToolsAsMcpServersOptions): { teamId?: string; teamMemberId?: string } {
  if (options.teamId || options.teamMemberId) return { teamId: options.teamId, teamMemberId: options.teamMemberId }
  if (!options.sessionId) return {}
  const member = teamMemberStore.getBySession(options.sessionId)
  if (!member) return {}
  return { teamId: member.team_id, teamMemberId: member.id }
}

/*
function oldResolveToolsAsMcpServers(agentId?: string, projectId?: string): Array<{
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
*/

function resolveToolGatewayArgs(): string[] {
  const distEntry = resolve(process.cwd(), 'dist/tools/tool-gateway.js')
  if (existsSync(distEntry)) return [distEntry]
  return ['--import', 'tsx', resolve(process.cwd(), 'src/tools/tool-gateway.ts')]
}
