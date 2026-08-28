import { toolStore } from '../../store/tools.js'
import { createChildLogger } from '../../core/logger.js'
import { getHandler } from '../handlers/index.js'
import { assertToolAllowed, toolDeniedResult } from '../permission-guard.js'
import { runScriptTool } from '../script-runner.js'
import { failToolCall, finishToolCall, recordToolCallStart } from './audit-service.js'
import { sanitizeRuntimeToolInputSchema } from './schema-sanitizer.js'
import { recordPlatformPresentationResult } from '../../core/platform-presentation-results.js'
import {
  trackAsyncOperation,
  trackSyncInvocation,
  trackSyncOperation,
} from '../../shared/operation-diagnostics.js'
import type {
  ToolConfig,
  ToolContext,
  ToolDefinition,
  ToolHandlerInput,
  ToolHandlerResult,
  ToolPermissions,
} from '../types.js'

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
  return toolStore
    .list()
    .filter((row) => row.enabled === 1 && visible.has(row.name) && row.type !== 'mcp')
    .map((row) => {
      const definition = rowToDefinition(row)
      return {
        name: definition.name,
        description: definition.description,
        inputSchema: sanitizeRuntimeToolInputSchema(
          definition.name,
          definition.inputSchema ?? { type: 'object', properties: {} },
          context,
        ),
      }
    })
}

export async function executeRuntimeTool(
  toolName: string,
  input: ToolHandlerInput,
  context: ToolRuntimeContext,
): Promise<ToolHandlerResult> {
  return trackAsyncOperation(
    {
      operationModule: 'tool-runtime',
      operation: 'execute',
      context: operationContext(context, toolName),
    },
    async () => executeRuntimeToolInternal(toolName, input, context),
  )
}

async function executeRuntimeToolInternal(
  toolName: string,
  input: ToolHandlerInput,
  context: ToolRuntimeContext,
): Promise<ToolHandlerResult> {
  if (!context.visibleTools.includes(toolName)) {
    const audit = recordAuditStart(context, toolName, input, 'denied')
    recordAuditFailure(audit.id, context, toolName, `工具不可见: ${toolName}`, 'denied')
    return {
      content: [{ type: 'text', text: `工具不可见或未绑定: ${toolName}` }],
      isError: true,
    }
  }

  const row = toolStore.getByName(toolName)
  if (!row || row.enabled !== 1 || row.type === 'mcp') {
    const audit = recordAuditStart(context, toolName, input, 'denied')
    recordAuditFailure(audit.id, context, toolName, `工具不存在或不可执行: ${toolName}`, 'denied')
    return {
      content: [{ type: 'text', text: `工具不存在或不可执行: ${toolName}` }],
      isError: true,
    }
  }

  const definition = rowToDefinition(row)
  const audit = recordAuditStart(context, toolName, input)

  try {
    const decision = assertToolAllowed(definition)
    if (!decision.allowed) {
      const result = toolDeniedResult(decision)
      recordAuditFailure(audit.id, context, toolName, decision.reason ?? 'Tool execution denied', 'denied')
      return result
    }

    const result = await trackSyncInvocation(
      {
        operationModule: 'tool-runtime',
        operation: 'handler.invoke',
        context: operationContext(context, toolName),
      },
      () => executeDefinition(definition, input, context),
    )
    if (result.isError) {
      recordAuditFailure(
        audit.id,
        context,
        toolName,
        result.content.map((item) => item.text).join('\n'),
        'failed',
      )
    } else {
      trackSyncOperation(
        {
          operationModule: 'store:tool-call-audit',
          operation: 'record.finish',
          context: operationContext(context, toolName),
        },
        () => finishToolCall(audit.id, result),
      )
      try {
        recordPlatformPresentationResult({
          auditId: audit.id,
          sessionId: context.sessionId,
          agentId: context.agentId,
          toolName,
          input,
          rawOutput: result.content,
        })
      } catch (error) {
        log.warn({ err: error, toolName, sessionId: context.sessionId, agentId: context.agentId }, '展示结果登记失败')
      }
    }
    return result
  } catch (err) {
    const message = (err as Error).message
    recordAuditFailure(audit.id, context, toolName, message, 'failed')
    log.error({ err, toolName, sessionId: context.sessionId, agentId: context.agentId }, '工具执行失败')
    return { content: [{ type: 'text', text: message }], isError: true }
  }
}

function recordAuditStart(
  context: ToolRuntimeContext,
  toolName: string,
  input: ToolHandlerInput,
  status?: 'denied',
): ReturnType<typeof recordToolCallStart> {
  return trackSyncOperation(
    {
      operationModule: 'store:tool-call-audit',
      operation: 'record.start',
      context: operationContext(context, toolName),
    },
    () => recordToolCallStart({ ...auditContext(context, toolName), input, status }),
  )
}

function recordAuditFailure(
  auditId: string,
  context: ToolRuntimeContext,
  toolName: string,
  error: string,
  status: 'failed' | 'denied' | 'timeout',
): void {
  trackSyncOperation(
    {
      operationModule: 'store:tool-call-audit',
      operation: 'record.fail',
      context: operationContext(context, toolName),
    },
    () => failToolCall(auditId, error, status),
  )
}

function operationContext(
  context: ToolRuntimeContext,
  toolName: string,
): { sessionId: string; agentId: string; projectId?: string; toolName: string } {
  return {
    sessionId: context.sessionId,
    agentId: context.agentId,
    projectId: context.projectId,
    toolName,
  }
}

async function executeDefinition(
  definition: ToolDefinition,
  input: ToolHandlerInput,
  context: ToolRuntimeContext,
): Promise<ToolHandlerResult> {
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

function auditContext(
  context: ToolRuntimeContext,
  toolName: string,
): { sessionId: string; agentId: string; projectId?: string; toolName: string } {
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
    inputSchema: row.input_schema_json ? (JSON.parse(row.input_schema_json) as object) : undefined,
    permissions: JSON.parse(row.permissions_json) as ToolPermissions,
    enabled: row.enabled === 1,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
