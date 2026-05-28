import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { initDatabase } from '../store/db.js'
import { toolStore } from '../store/tools.js'
import { loadConfig } from '../core/config.js'
import { getAllHandlers } from './handlers/index.js'
import { executeRuntimeTool, type ToolRuntimeContext } from './runtime/tool-runtime.js'
import type { ToolDefinition, ToolHandler, ToolHandlerInput, ToolHandlerResult } from './types.js'

export interface GatewayOptions {
  toolIds?: string[]
  toolNames?: string[]
  projectId?: string
  agentId?: string
  workDir?: string
}

export interface GatewayTool {
  name: string
  description: string
  inputSchema: object
  execute: (input: ToolHandlerInput) => Promise<ToolHandlerResult>
}

function rowToDefinition(row: ReturnType<typeof toolStore.get>): ToolDefinition | null {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    category: row.category as ToolDefinition['category'],
    type: row.type as ToolDefinition['type'],
    config: JSON.parse(row.config_json),
    inputSchema: row.input_schema_json ? JSON.parse(row.input_schema_json) as object : undefined,
    permissions: JSON.parse(row.permissions_json),
    enabled: row.enabled === 1,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function buildGatewayTools(options: GatewayOptions): GatewayTool[] {
  const definitions = selectDefinitions(options)
  const context: ToolRuntimeContext = {
    sessionId: `stdio-${options.agentId ?? 'anonymous'}`,
    agentId: options.agentId ?? 'anonymous',
    projectId: options.projectId,
    workDir: options.workDir ?? process.cwd(),
    visibleTools: definitions.map(definition => definition.name),
  }

  return definitions.map((definition) => createGatewayTool(definition, context)).filter((tool): tool is GatewayTool => !!tool)
}

function selectDefinitions(options: GatewayOptions): ToolDefinition[] {
  const byIds = options.toolIds?.filter(Boolean) ?? []
  if (byIds.length > 0) {
    return byIds.map(id => rowToDefinition(toolStore.get(id))).filter((tool): tool is ToolDefinition => !!tool && tool.enabled)
  }

  const names = new Set(options.toolNames?.filter(Boolean) ?? [])
  if (names.size === 0) return getAllHandlers().map(handlerToDefinition)

  return toolStore.list()
    .filter(row => row.enabled === 1 && names.has(row.name))
    .map(row => rowToDefinition(row))
    .filter((tool): tool is ToolDefinition => !!tool)
}

function createGatewayTool(definition: ToolDefinition, context: ToolRuntimeContext): GatewayTool | null {
  if (definition.type !== 'builtin' && definition.type !== 'script') return null
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema ?? { type: 'object', properties: {} },
    async execute(input) {
      return executeRuntimeTool(definition.name, input, context)
    },
  }
}

function handlerToDefinition(handler: ToolHandler): ToolDefinition {
  const now = new Date().toISOString()
  return {
    id: handler.name,
    name: handler.name,
    displayName: handler.name,
    description: handler.description,
    category: 'automation',
    type: 'builtin',
    config: { handler: handler.name },
    inputSchema: handler.inputSchema,
    permissions: { requiresApproval: false, maxExecutionTime: 30_000, networkAccess: false },
    enabled: true,
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
  }
}

type ZodShape = Record<string, z.ZodType>

export function jsonSchemaPropsToZodShape(schema: Record<string, unknown>): ZodShape {
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; description?: string; enum?: string[]; items?: unknown }>
  const required = new Set((schema.required ?? []) as string[])
  const shape: ZodShape = {}

  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodType
    switch (prop.type) {
      case 'number':
      case 'integer': field = z.number(); break
      case 'boolean': field = z.boolean(); break
      case 'array': field = z.array(z.unknown()); break
      case 'object': field = z.record(z.string(), z.unknown()); break
      default: field = prop.enum?.length ? z.enum(prop.enum as [string, ...string[]]) : z.string()
    }
    if (prop.description) field = field.describe(prop.description)
    if (!required.has(key)) field = field.optional()
    shape[key] = field
  }

  return shape
}

export function registerGatewayTools(server: McpServer, tools: GatewayTool[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: jsonSchemaPropsToZodShape(tool.inputSchema as Record<string, unknown>),
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => tool.execute(args) as Promise<CallToolResult>,
    )
  }
}

function readOptionsFromEnv(): GatewayOptions {
  return {
    toolIds: process.env.TOOL_IDS?.split(',').filter(Boolean),
    toolNames: process.env.TOOL_NAMES?.split(',').filter(Boolean),
    projectId: process.env.PROJECT_ID || undefined,
    agentId: process.env.AGENT_ID || undefined,
    workDir: process.env.WORK_DIR || process.cwd(),
  }
}

export async function startToolGateway(options = readOptionsFromEnv()): Promise<void> {
  const server = new McpServer({ name: 'ai-ide-tool-gateway', version: '1.0.0' })
  registerGatewayTools(server, buildGatewayTools(options))
  await server.connect(new StdioServerTransport())
}

function ensureDatabase(): void {
  const config = loadConfig()
  initDatabase(resolve(config.dataDir, 'ai-ide.sqlite'))
}

function isDirectRun(): boolean {
  return !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isDirectRun()) {
  ensureDatabase()
  await startToolGateway()
}
