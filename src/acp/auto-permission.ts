import * as acp from '@agentclientprotocol/sdk'
import { teamMemberStore } from '../store/teams.js'
import { resolveVisiblePlatformTools } from '../tools/registry/visibility-resolver.js'

const INTERNAL_MCP_SERVER_NAMES = new Set(['ai-ide-tools', 'ai-ide-tool-gateway'])
const AUTO_APPROVED_TEAM_TOOLS = new Set(['team.mailbox.send', 'team.task.update'])

export interface AutoPermissionInput {
  agentId: string
  ourSessionId: string
  toolCall: acp.ToolCallUpdate
  options: acp.PermissionOption[]
}

export function resolveAutoPermission(input: AutoPermissionInput): acp.RequestPermissionResponse | undefined {
  const requested = extractInternalMcpTool(input.toolCall)
  if (!requested) return undefined

  const member = teamMemberStore.getBySession(input.ourSessionId)
  if (!member) return undefined

  const visibleTool = resolveVisiblePlatformTools({
    agentId: input.agentId,
    projectId: member.project_id,
    sessionId: input.ourSessionId,
  }).find((tool) => normalizeToolName(tool.definition.name) === normalizeToolName(requested.toolName))

  if (!visibleTool) return undefined
  if (!AUTO_APPROVED_TEAM_TOOLS.has(visibleTool.definition.name)) return undefined
  if (visibleTool.definition.permissions.requiresApproval) return undefined

  const option = chooseAllowOption(input.options)
  if (!option) return undefined

  return { outcome: { outcome: 'selected', optionId: option.optionId } }
}

function extractInternalMcpTool(toolCall: acp.ToolCallUpdate): { serverName: string; toolName: string } | undefined {
  const title = typeof toolCall.title === 'string' ? toolCall.title : undefined
  if (!title?.startsWith('mcp__')) return undefined

  const parts = title.split('__')
  if (parts.length < 3) return undefined

  const serverName = parts[1]
  if (!INTERNAL_MCP_SERVER_NAMES.has(serverName)) return undefined

  return { serverName, toolName: parts.slice(2).join('__') }
}

function chooseAllowOption(options: acp.PermissionOption[]): acp.PermissionOption | undefined {
  return options.find((option) => option.kind === 'allow_always') ?? options.find((option) => option.kind === 'allow_once')
}

function normalizeToolName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase()
}
