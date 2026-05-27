#!/usr/bin/env node
/**
 * 内置工具 MCP 桥接服务器
 *
 * 作为独立进程启动，通过 stdio 与 Agent 通信。
 * 环境变量 TOOL_NAMES 指定要暴露的工具集合（逗号分隔）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getHandler, getAllHandlers } from './handlers/index.js'
import type { ToolContext } from './types.js'

const toolNames = process.env.TOOL_NAMES?.split(',').filter(Boolean) ?? []
const projectId = process.env.PROJECT_ID || undefined
const agentId = process.env.AGENT_ID || undefined

const server = new McpServer({
  name: 'ai-ide-studio-tools',
  version: '1.0.0',
})

const context: ToolContext = {
  projectId,
  agentId,
  workDir: process.cwd(),
}

type ZodShape = Record<string, z.ZodType>

function jsonSchemaPropsToZodShape(schema: Record<string, unknown>): ZodShape {
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; description?: string; enum?: string[] }>
  const required = new Set((schema.required ?? []) as string[])
  const shape: ZodShape = {}

  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodType

    switch (prop.type) {
      case 'number':
      case 'integer':
        field = z.number()
        break
      case 'boolean':
        field = z.boolean()
        break
      case 'array':
        field = z.array(z.unknown())
        break
      case 'object':
        field = z.record(z.string(), z.unknown())
        break
      default:
        field = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string()
    }

    if (prop.description) field = field.describe(prop.description)
    if (!required.has(key)) field = field.optional()

    shape[key] = field
  }

  return shape
}

const handlers = toolNames.length > 0
  ? toolNames.map(n => getHandler(n)).filter(Boolean)
  : getAllHandlers()

for (const handler of handlers) {
  if (!handler) continue

  const zodShape = jsonSchemaPropsToZodShape(handler.inputSchema as Record<string, unknown>)

  server.registerTool(
    handler.name,
    {
      description: handler.description,
      inputSchema: zodShape,
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await handler.execute(args, context)
        return {
          content: result.content,
          ...(result.isError ? { isError: true } : {}),
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `工具执行错误: ${(err as Error).message}` }],
          isError: true,
        }
      }
    },
  )
}

const transport = new StdioServerTransport()
await server.connect(transport)
