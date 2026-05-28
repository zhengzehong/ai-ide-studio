import { toolStore } from '../../store/tools.js'
import { createChildLogger } from '../../core/logger.js'
import { getHandler } from '../handlers/index.js'
import { assertToolAllowed, toolDeniedResult } from '../permission-guard.js'
import { runScriptTool } from '../script-runner.js'
import { failToolCall, finishToolCall, recordToolCallStart } from './audit-service.js'
import type { ToolConfig, ToolContext, ToolDefinition, ToolHandlerInput, ToolHandlerResult, ToolPermissions } from '../types.js'

const log = createChildLogger('tool-runtime')

export interface ToolRuntimeContext extends ToolContext {
  sessionId: string
  agentId: string
  visibleTools: string[]
}

export interface RuntimeToolDefinition {
  name: string
  description: string
  inputSchema: object
}

type ToolRow = ReturnType<typeof toolStore.list>[number]

export function listRuntimeTools(context: ToolRuntimeContext): RuntimeToolDefinition[] {
  const visible = new Set(context.visibleTools)
  return toolStore.list()
    .filter(row => row.enabled === 1 && visible.has(row.name) && row.type !== 'mcp')
    .map(row => {
      const definition = rowToDefinition(row)
      return {
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema ?? { type: 'object', properties: {} },
      }
    })
}

export async function executeRuntimeTool(toolName: string, input: ToolHandlerInput, context: ToolRuntimeContext): Promise<ToolHandlerResult> {
  if (!context.visibleTools.includes(toolName)) {
    const audit = recordToolCallStart({ ...auditContext(context, toolName), input, status: 'denied' })
    failToolCall(audit.id, `工具不可见: ${toolName}`, 'denied')
    return {
      content: [{ type: 'text', text: `工具不可见或未绑定: ${toolName}` }],
      isError: true,
    }
  }

  const row = toolStore.getByName(toolName)
  if (!row || row.enabled !== 1 || row.type === 'mcp') {
    const audit = recordToolCallStart({ ...auditContext(context, toolName), input, status: 'denied' })
    failToolCall(audit.id, `工具不存在或不可执行: ${toolName}`, 'denied')
    return {
      content: [{ type: 'text', text: `工具不存在或不可执行: ${toolName}` }],
      isError: true,
    }
  }

  const definition = rowToDefinition(row)
  const audit = recordToolCallStart({ ...auditContext(context, toolName), input })

  try {
    const decision = assertToolAllowed(definition)
    if (!decision.allowed) {
      const result = toolDeniedResult(decision)
      failToolCall(audit.id, decision.reason ?? 'Tool execution denied', 'denied')
      return result
    }

    const result = await executeDefinition(definition, input, context)
    if (result.isError) {
      failToolCall(audit.id, result.content.map(item => item.text).join('\n'), 'failed')
    } else {
      finishToolCall(audit.id, result)
    }
    return result
  } catch (err) {
    const message = (err as Error).message
    failToolCall(audit.id, message, 'failed')
    log.error({ err, toolName, sessionId: context.sessionId, agentId: context.agentId }, '工具执行失败')
    return { content: [{ type: 'text', text: message }], isError: true }
  }
}

async function executeDefinition(definition: ToolDefinition, input: ToolHandlerInput, context: ToolRuntimeContext): Promise<ToolHandlerResult> {
  if (definition.type === 'builtin') {
    const handlerName = (definition.config as { handler?: string }).handler ?? definition.name
    const handler = getHandler(definition.name) ?? getHandler(handlerName)
    if (!handler) {
      return { content: [{ type: 'text', text: `内置工具 handler 不存在: ${definition.name}` }], isError: true }
    }
    return handler.execute(input, context)
  }

  if (definition.type === 'script') {
    return runScriptTool(definition, input, context)
  }

  return { content: [{ type: 'text', text: `不支持的工具类型: ${definition.type}` }], isError: true }
}

function auditContext(context: ToolRuntimeContext, toolName: string): { sessionId: string; agentId: string; projectId?: string; toolName: string } {
  return {
    sessionId: context.sessionId,
    agentId: context.agentId,
    projectId: context.projectId,
    toolName,
  }
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
    inputSchema: row.input_schema_json ? JSON.parse(row.input_schema_json) as object : undefined,
    permissions: JSON.parse(row.permissions_json) as ToolPermissions,
    enabled: row.enabled === 1,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
