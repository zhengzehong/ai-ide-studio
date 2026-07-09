import { agentSessionCommunicationService } from '../../core/agent-session-communication.js'
import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

export const agentMessageSendHandler: ToolHandler = {
  name: 'agent.message.send',
  description: '向另一个 Agent 会话发送消息。异步投递，调用后立即返回，不要等待目标 Agent 完成。如果 needReply=true，发送后结束当前轮；目标 Agent 回传后系统会自动唤醒来源会话。只传 targetAgentId 时会创建新会话。',
  inputSchema: {
    type: 'object',
    properties: {
      targetAgentId: { type: 'string' },
      targetSessionId: { type: 'string' },
      content: { type: 'string' },
      relatedInfo: { type: 'object' },
      needReply: { type: 'boolean' },
    },
    required: ['content'],
  },
  async execute(input, context) {
    const result = await agentSessionCommunicationService.sendMessage({
      context,
      targetAgentId: optionalString(input, 'targetAgentId'),
      targetSessionId: optionalString(input, 'targetSessionId'),
      content: requireString(input, 'content'),
      relatedInfo: optionalRecord(input, 'relatedInfo'),
      needReply: input.needReply === true,
    })
    return jsonResult({ message: result.message, targetSession: result.targetSession })
  },
}

export const agentSessionListHandler: ToolHandler = {
  name: 'agent.session.list',
  description: '查看某个 Agent 在当前项目内的会话列表。',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['agentId'],
  },
  async execute(input, context) {
    const sessions = agentSessionCommunicationService.listSessions(
      requireString(input, 'agentId'),
      context.projectId,
      optionalNumber(input, 'limit'),
    )
    return jsonResult({ sessions })
  },
}

export const agentSessionMessagesHandler: ToolHandler = {
  name: 'agent.session.messages',
  description: '查看某个会话的最近消息。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['sessionId'],
  },
  async execute(input, context) {
    const messages = agentSessionCommunicationService.listMessages(
      requireString(input, 'sessionId'),
      context.projectId,
      optionalNumber(input, 'limit'),
    )
    return jsonResult({ messages })
  },
}

export const agentSessionWatchHandler: ToolHandler = {
  name: 'agent.session.watch',
  description: '一次性监听另一个会话的完成事件。被监听会话执行完一轮后,系统自动唤醒你的会话。单次触发后自动失效,不支持取消。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: '被监听会话 ID' },
      relatedInfo: { type: 'object', description: '动态关联信息 JSON' },
    },
    required: ['sessionId'],
  },
  async execute(input, context) {
    const watch = agentSessionCommunicationService.createWatch({
      context,
      sessionId: requireString(input, 'sessionId'),
      once: true,
      relatedInfo: optionalRecord(input, 'relatedInfo'),
    })
    return jsonResult({ watchId: watch.id, sessionId: watch.watched_session_id })
  },
}

export const agentTaskWatchHandler: ToolHandler = {
  name: 'agent.task.watch',
  description: '持续性监听一个任务。触发时机:步骤 done / 步骤 blocked / 任务 completed / 任务回退到 draft。updateProgress/milestone/ready/pending 不触发。需要用 agent.task.watch.cancel 取消。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '被监听任务 ID' },
      relatedInfo: { type: 'object', description: '动态关联信息 JSON' },
    },
    required: ['taskId'],
  },
  async execute(input, context) {
    const watch = agentSessionCommunicationService.createTaskWatch({
      context,
      taskId: requireString(input, 'taskId'),
      relatedInfo: optionalRecord(input, 'relatedInfo'),
    })
    return jsonResult({ watchId: watch.id, taskId: watch.task_id })
  },
}

export const agentTaskWatchCancelHandler: ToolHandler = {
  name: 'agent.task.watch.cancel',
  description: '取消 agent.task.watch 创建的监听。',
  inputSchema: {
    type: 'object',
    properties: { watchId: { type: 'string', description: 'Watch ID' } },
    required: ['watchId'],
  },
  async execute(input, context) {
    const watch = agentSessionCommunicationService.cancelWatch(
      requireString(input, 'watchId'),
      context,
    )
    return jsonResult({ ok: true, cancelled: watch.id })
  },
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value.trim()
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(input: ToolHandlerInput, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' ? value : undefined
}

function optionalRecord(input: ToolHandlerInput, key: string): Record<string, unknown> | undefined {
  const value = input[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
