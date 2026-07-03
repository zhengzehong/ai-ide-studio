import { agentHubService } from '../../core/agent-hub/index.js'
import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

export const agentHubConnectHandler: ToolHandler = {
  name: 'agent_hub.connect',
  description: '连接到 A2A Hub,注册当前会话,可被其他机器的 Agent 调用。零参数,平台自动配置。重复调用幂等,返回当前可见 Agent 列表。',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_input, context): Promise<ToolHandlerResult> {
    if (!context.sessionId) return err('缺少 sessionId')
    if (!context.agentId) return err('缺少 agentId')
    try {
      const result = await agentHubService.connect(context.sessionId, context.agentId, context.projectId)
      return jsonResult(result)
    } catch (e) {
      return err((e as Error).message)
    }
  },
}

export const agentHubDisconnectHandler: ToolHandler = {
  name: 'agent_hub.disconnect',
  description: '断开与 A2A Hub 的连接,清理 Hub 注册和 SSE 长连接。未连接时返回 not_connected,幂等不报错。',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_input, context): Promise<ToolHandlerResult> {
    if (!context.sessionId) return err('缺少 sessionId')
    const result = await agentHubService.disconnect(context.sessionId)
    return jsonResult(result)
  },
}

export const agentHubListHandler: ToolHandler = {
  name: 'agent_hub.list',
  description: '列出 A2A Hub 上可发现的其他 Agent。可选 scopeKeys / match 过滤,默认用内置 scopeKeys。',
  inputSchema: {
    type: 'object',
    properties: {
      scopeKeys: { type: 'array', items: { type: 'string' } },
      match: { type: 'string', enum: ['any', 'all'] },
    },
    additionalProperties: false,
  },
  async execute(input, context): Promise<ToolHandlerResult> {
    if (!context.sessionId) return err('缺少 sessionId')
    const scopeKeys = optionalStringArray(input, 'scopeKeys')
    const match = optionalMatch(input, 'match')
    const result = await agentHubService.list(context.sessionId, scopeKeys, match)
    if (result.status === 'not_connected') return err(result.reason)
    return jsonResult(result)
  },
}

export const agentHubSendHandler: ToolHandler = {
  name: 'agent_hub.send',
  description: '向 A2A Hub 上的另一个 Agent 发消息(异步)。Hub 返回 hubTaskId 后立即返回,对方处理完成后结果会自动注入当前会话,无需轮询。',
  inputSchema: {
    type: 'object',
    required: ['targetHubAgentId', 'message'],
    properties: {
      targetHubAgentId: { type: 'string' },
      message: { type: 'string' },
      contextId: { type: 'string' },
    },
    additionalProperties: false,
  },
  async execute(input, context): Promise<ToolHandlerResult> {
    if (!context.sessionId) return err('缺少 sessionId')
    const targetHubAgentId = requireString(input, 'targetHubAgentId')
    const message = requireString(input, 'message')
    const contextId = optionalString(input, 'contextId')
    try {
      const result = await agentHubService.send(context.sessionId, targetHubAgentId, message, contextId)
      return jsonResult(result)
    } catch (e) {
      return err((e as Error).message)
    }
  },
}

export const agentHubUploadFileHandler: ToolHandler = {
  name: 'agent_hub.upload_file',
  description:
    '上传文件到 Agent Hub,返回可下载的 url。上传后请将返回的 url 直接写入你的消息文本中发给对方,对方即可通过该 url 下载文件。用于跨 Agent 传文件场景(如发送代码片段、文档、图片等)。',
  inputSchema: {
    type: 'object',
    required: ['filePath'],
    properties: {
      filePath: { type: 'string', description: '本地文件绝对路径' },
      purpose: { type: 'string', description: '用途标记,可选' },
    },
    additionalProperties: false,
  },
  async execute(input, context): Promise<ToolHandlerResult> {
    if (!context.sessionId) return err('缺少 sessionId')
    const filePath = requireString(input, 'filePath')
    const purpose = optionalString(input, 'purpose')
    try {
      const result = await agentHubService.uploadFile(context.sessionId, filePath, purpose)
      const guideText = `文件已上传到 Hub。
- url: ${result.url}
- filename: ${result.filename}
- mediaType: ${result.mediaType}
- size: ${result.size}

请在你的回复消息中直接写入上面的 url,对方 Agent 即可通过该 url 下载文件。`
      return { content: [{ type: 'text', text: guideText }] }
    } catch (e) {
      return err((e as Error).message)
    }
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

function optionalStringArray(input: ToolHandlerInput, key: string): string[] | undefined {
  const value = input[key]
  if (!Array.isArray(value)) return undefined
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
}

function optionalMatch(input: ToolHandlerInput, key: string): 'any' | 'all' | undefined {
  const value = input[key]
  return value === 'any' || value === 'all' ? value : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function err(message: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
}
