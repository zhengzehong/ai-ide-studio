import { sessionStore } from '../../../store/sessions.js'
import { timelineStore } from '../../../store/timeline.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listTimelineHandler: ToolHandler = {
  name: 'core.timeline.list',
  description: '列出指定会话的时间线摘要',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      status: { type: 'string', enum: ['raw', 'refined'] },
      limit: { type: 'number' },
    },
    required: ['sessionId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const sessionId = requireString(input, 'sessionId')
    const session = sessionStore.get(sessionId)
    if (!session) return errorResult(`Session 不存在: ${sessionId}`)
    if (context.projectId && session.project_id !== context.projectId) return errorResult('权限不足：该会话不属于当前项目')

    const status = optionalTimelineStatus(input.status)
    const limit = optionalPositiveInteger(input.limit)
    let items = timelineStore.list(sessionId)
    if (status) items = items.filter((item) => item.status === status)
    if (limit !== undefined) items = items.slice(-limit)
    return jsonResult({ items })
  },
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value.trim()
}

function optionalTimelineStatus(value: unknown): 'raw' | 'refined' | undefined {
  return value === 'raw' || value === 'refined' ? value : undefined
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
