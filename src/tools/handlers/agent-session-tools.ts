import { agentSessionCommunicationService } from '../../core/agent-session-communication.js'
import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

export const agentMessageSendHandler: ToolHandler = {
  name: 'agent.message.send',
  description: '向另一个 Agent 会话发送消息；只传 targetAgentId 时会创建新会话。',
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

export const agentWatchCreateHandler: ToolHandler = {
  name: 'agent.watch.create',
  description: '监听另一个会话的下一次完成事件；once 默认 true。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      once: { type: 'boolean' },
      relatedInfo: { type: 'object' },
    },
    required: ['sessionId'],
  },
  async execute(input, context) {
    const watch = agentSessionCommunicationService.createWatch({
      context,
      sessionId: requireString(input, 'sessionId'),
      once: input.once === false ? false : true,
      relatedInfo: optionalRecord(input, 'relatedInfo'),
    })
    return jsonResult({ watch })
  },
}

export const agentWatchCancelHandler: ToolHandler = {
  name: 'agent.watch.cancel',
  description: '取消当前会话创建的 watch。',
  inputSchema: {
    type: 'object',
    properties: { watchId: { type: 'string' } },
    required: ['watchId'],
  },
  async execute(input, context) {
    const watch = agentSessionCommunicationService.cancelWatch(requireString(input, 'watchId'), context)
    return jsonResult({ watch })
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
