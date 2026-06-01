import { toolStore, toolBindingStore } from '../../store/tools.js'
import { createChildLogger } from '../../core/logger.js'
import { teamMemberStore } from '../../store/teams.js'
import { TEAM_LEADER_INITIAL_HIDDEN_TOOLS } from '../team-profiles.js'
import type { ResolvedTool, ToolBinding, ToolConfig, ToolDefinition, ToolPermissions } from '../types.js'

const log = createChildLogger('tool-visibility-resolver')

type ToolRow = ReturnType<typeof toolStore.list>[number]
type BindingRow = ReturnType<typeof toolBindingStore.list>[number]

export interface ResolveVisiblePlatformToolsInput {
  agentId?: string
  projectId?: string
  sessionId?: string
}

export function resolveVisiblePlatformTools(input: ResolveVisiblePlatformToolsInput): ResolvedTool[] {
  const allBindings = toolBindingStore.list()
  const allTools = toolStore.list().filter((row) => row.enabled === 1 && row.type !== 'mcp')
  const hiddenToolNames = resolveHiddenToolNames(input, allTools, allBindings)
  const resolved: ResolvedTool[] = []

  for (const toolRow of allTools) {
    if (hiddenToolNames.has(toolRow.name)) continue
    const decision = resolveBindingForTool(toolRow.id, allBindings, input)
    if (!decision.visible || !decision.binding) continue

    const definition = rowToDefinition(toolRow)
    const binding = rowToBinding(decision.binding)
    const effectiveConfig = binding.configOverride
      ? ({ ...definition.config, ...binding.configOverride } as ToolConfig)
      : definition.config

    resolved.push({ definition, binding, effectiveConfig })
  }

  log.debug(
    { agentId: input.agentId, projectId: input.projectId, sessionId: input.sessionId, count: resolved.length },
    'resolved visible platform tools',
  )
  return resolved
}

function resolveHiddenToolNames(
  input: ResolveVisiblePlatformToolsInput,
  tools: ToolRow[],
  bindings: BindingRow[],
): Set<string> {
  if (input.sessionId) {
    const member = teamMemberStore.getBySession(input.sessionId)
    if (member?.role === 'leader') return new Set(TEAM_LEADER_INITIAL_HIDDEN_TOOLS)
  }
  const leaderTool = tools.find((tool) => tool.name === 'team.member.message')
  if (!leaderTool) return new Set()
  const decision = resolveBindingForTool(leaderTool.id, bindings, input)
  return decision.visible ? new Set(TEAM_LEADER_INITIAL_HIDDEN_TOOLS) : new Set()
}

function resolveBindingForTool(
  toolId: string,
  bindings: BindingRow[],
  input: ResolveVisiblePlatformToolsInput,
): { visible: boolean; binding?: BindingRow } {
  const candidates = bindings.filter((binding) => binding.tool_id === toolId)
  let selected: BindingRow | undefined
  let visible = false

  const apply = (scope: ToolBinding['scope'], targetId: string | null | undefined) => {
    const binding = candidates.find((row) => row.scope === scope && row.target_id === (targetId ?? null))
    if (!binding) return
    selected = binding
    visible = binding.enabled === 1
  }

  apply('global', null)
  if (input.projectId) apply('project', input.projectId)
  if (input.agentId) apply('agent', input.agentId)

  return { visible, binding: selected }
}

function rowToDefinition(row: ToolRow): ToolDefinition {
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

function rowToBinding(row: BindingRow): ToolBinding {
  return {
    id: row.id,
    toolId: row.tool_id,
    scope: row.scope as ToolBinding['scope'],
    targetId: row.target_id,
    enabled: row.enabled === 1,
    configOverride: row.config_override_json
      ? (JSON.parse(row.config_override_json) as Record<string, unknown>)
      : undefined,
    createdAt: row.created_at,
  }
}
