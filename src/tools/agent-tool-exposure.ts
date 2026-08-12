const HIDDEN_AGENT_TOOL_PREFIXES = ['team.'] as const

export function isAgentVisiblePlatformTool(toolName: string): boolean {
  return !HIDDEN_AGENT_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))
}
