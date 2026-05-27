export type ToolType = 'builtin' | 'mcp' | 'script'
export type ToolCategory = 'browser' | 'filesystem' | 'network' | 'automation' | 'code' | 'data' | 'custom'
export type BindingScope = 'global' | 'project' | 'agent'

export interface McpConfig {
  command: string
  args: string[]
  env?: Record<string, string>
  transport: 'stdio' | 'sse'
}

export interface BuiltinConfig {
  handler: string
}

export interface ScriptConfig {
  scriptPath: string
  runtime: 'node' | 'bun'
  timeout?: number
}

export type ToolConfig = McpConfig | BuiltinConfig | ScriptConfig

export interface ToolPermissions {
  requiresApproval: boolean
  allowedPaths?: string[]
  maxExecutionTime: number
  networkAccess: boolean
}

export interface ToolDefinition {
  id: string
  name: string
  displayName: string
  description: string
  category: ToolCategory
  type: ToolType
  config: ToolConfig
  inputSchema?: object
  permissions: ToolPermissions
  enabled: boolean
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
}

export interface ToolBinding {
  id: string
  toolId: string
  scope: BindingScope
  targetId: string | null
  enabled: boolean
  configOverride?: Record<string, unknown>
  createdAt: string
}

export interface ResolvedTool {
  definition: ToolDefinition
  binding: ToolBinding | null
  effectiveConfig: ToolConfig
}

export interface ToolHandlerInput {
  [key: string]: unknown
}

export interface ToolHandlerResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export interface ToolHandler {
  name: string
  description: string
  inputSchema: object
  execute: (input: ToolHandlerInput, context: ToolContext) => Promise<ToolHandlerResult>
}

export interface ToolContext {
  projectId?: string
  agentId?: string
  sessionId?: string
  workDir?: string
}

export const DEFAULT_PERMISSIONS: ToolPermissions = {
  requiresApproval: false,
  maxExecutionTime: 30_000,
  networkAccess: false,
}
