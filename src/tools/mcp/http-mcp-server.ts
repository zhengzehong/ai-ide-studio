import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Hono } from 'hono'
import { validateToolToken } from '../registry/context-registry.js'
import { executeRuntimeTool, listRuntimeTools, type ToolRuntimeContext } from '../runtime/tool-runtime.js'
import { jsonSchemaPropsToZodShape } from '../tool-gateway.js'
import { createChildLogger } from '../../core/logger.js'

const log = createChildLogger('http-mcp-server')

export function mountHttpMcpServer(app: Hono): void {
  app.all('/mcp', async (c) => {
    const token = readBearerToken(c.req.header('Authorization'))
    if (!token) return c.text('Missing bearer token', 401)

    const contextRecord = validateToolToken(token)
    if (!contextRecord) return c.text('Invalid tool token', 401)

    const transport = new WebStandardStreamableHTTPServerTransport()
    const server = createServer({
      sessionId: contextRecord.sessionId,
      agentId: contextRecord.agentId,
      projectId: contextRecord.projectId,
      teamId: contextRecord.teamId,
      teamMemberId: contextRecord.teamMemberId,
      visibleTools: contextRecord.visibleTools,
      workDir: process.cwd(),
    })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })
}

function createServer(context: ToolRuntimeContext): McpServer {
  const server = new McpServer({ name: 'ai-ide-tools', version: '0.2.0' })

  for (const tool of listRuntimeTools(context)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: jsonSchemaPropsToZodShape(tool.inputSchema as Record<string, unknown>),
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => executeRuntimeTool(tool.name, args, context) as Promise<CallToolResult>,
    )
  }

  log.debug({ sessionId: context.sessionId, agentId: context.agentId, toolCount: context.visibleTools.length }, 'HTTP MCP server created')
  return server
}

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? null
}
