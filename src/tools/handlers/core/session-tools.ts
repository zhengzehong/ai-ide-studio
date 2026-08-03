import { agentStore } from '../../../store/agents.js'
import { messageStore, sessionStore, type SessionRow } from '../../../store/sessions.js'
import { sessionManager } from '../../../core/sessions.js'
import {
  configureSessionRuntime,
  getSessionRuntimeCapabilities,
  type SessionRuntimeConfigValue,
} from '../../../core/session-runtime-control.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listSessionsHandler: ToolHandler = {
  name: 'core.session.list',
  description: '列出会话',
  inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, projectId: { type: 'string' } } },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const agentId = optionalString(input, 'agentId')
    const projectId = context.projectId ?? optionalString(input, 'projectId')
    return jsonResult({ sessions: sessionStore.listWithRuntimeState(agentId, projectId, sessionManager.isPromptActive) })
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
    const projectId = context.projectId ?? optionalString(input, 'projectId')
    const taskId = optionalString(input, 'taskId')
    assertAgentInProject(agentId, projectId)
    const session = await sessionManager.createSession(agentId, taskId, projectId)
    return jsonResult({ session })
  },
}

export const getSessionCapabilitiesHandler: ToolHandler = {
  name: 'core.session.capabilities',
  description: '创建或恢复真实 ACP Session，并返回实际可用的模型、模式和配置项；不会发送 Prompt。',
  inputSchema: {
    type: 'object',
    properties: { sessionId: { type: 'string', description: 'Session ID' } },
    required: ['sessionId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const session = requireAccessibleSession(requireString(input, 'sessionId'), context.projectId)
    return jsonResult(await getSessionRuntimeCapabilities(session.id, { emitLifecycle: false }))
  },
}

export const configureSessionHandler: ToolHandler = {
  name: 'core.session.configure',
  description: '在空闲的新 Session 上配置真实 ACP 模型、模式或配置项；Runtime 确认后才持久化。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
      modelId: { type: 'string', description: 'core.session.capabilities 返回的准确 modelId' },
      modeId: { type: 'string', description: 'core.session.capabilities 返回的准确 modeId' },
      config: {
        type: 'object',
        description: 'Session config option ID 到 string/boolean 值的映射',
        additionalProperties: { type: ['string', 'boolean'] },
      },
    },
    required: ['sessionId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const session = requireAccessibleSession(requireString(input, 'sessionId'), context.projectId)
    requireUnusedSession(session)
    return jsonResult(await configureSessionRuntime(session.id, {
      modelId: optionalString(input, 'modelId'),
      modeId: optionalString(input, 'modeId'),
      config: optionalConfig(input.config),
    }))
  },
}

function assertAgentInProject(agentId: string, projectId: string | undefined): void {
  if (!projectId) return
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  if (agent.project_id !== projectId) throw new Error(`Project mismatch: Agent ${agentId} is outside current project`)
}

function requireAccessibleSession(sessionId: string, projectId: string | undefined): SessionRow {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`Session 不存在: ${sessionId}`)
  if (projectId && session.project_id !== projectId) throw new Error('Session 不属于当前项目')
  if (session.status !== 'active' || session.archived_at || session.deleted_at || session.is_template === 1) {
    throw new Error('只能配置活动的普通 Session')
  }
  return session
}

function requireUnusedSession(session: SessionRow): void {
  if (sessionManager.isPromptPending(session.id)) throw new Error('会话正在处理或等待 Prompt')
  if (messageStore.list(session.id, { limit: 1, includeLatestToolCalls: false }).length > 0) {
    throw new Error('只能配置尚未发送消息的新会话')
  }
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalConfig(value: unknown): Record<string, SessionRuntimeConfigValue> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config 必须是对象')
  const config: Record<string, SessionRuntimeConfigValue> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) throw new Error('config ID 不能为空')
    if (typeof item !== 'string' && typeof item !== 'boolean') {
      throw new Error(`config.${key} 必须是 string 或 boolean`)
    }
    config[key] = item
  }
  return Object.keys(config).length > 0 ? config : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
