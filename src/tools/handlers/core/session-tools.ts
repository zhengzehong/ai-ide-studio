import { sessionStore } from '../../../store/sessions.js'
import { sessionManager } from '../../../core/sessions.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listSessionsHandler: ToolHandler = {
  name: 'core.session.list',
  description: '列出会话',
  inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, projectId: { type: 'string' } } },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const agentId = optionalString(input, 'agentId')
    const projectId = optionalString(input, 'projectId') ?? context.projectId
    return jsonResult({ sessions: sessionStore.list(agentId, projectId) })
  },
}

export const getSessionHandler: ToolHandler = {
  name: 'core.session.get',
  description: '获取会话详情',
  inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const sessionId = requireString(input, 'sessionId')
    const session = sessionStore.get(sessionId)
    if (!session) return errorResult(`Session 不存在: ${sessionId}`)
    return jsonResult({ session })
  },
}

export const createSessionHandler: ToolHandler = {
  name: 'core.session.create',
  description: '创建会话',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string' },
      projectId: { type: 'string' },
      taskId: { type: 'string' },
    },
    required: ['agentId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const agentId = requireString(input, 'agentId')
    const projectId = optionalString(input, 'projectId') ?? context.projectId
    const taskId = optionalString(input, 'taskId')
    const session = await sessionManager.createSession(agentId, taskId, projectId)
    return jsonResult({ session })
  },
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
