import {
  addAgentAutonomyInterest,
  disableAgentAutonomy,
  enableAgentAutonomy,
  getAgentAutonomyState,
  listProjectAutonomyStates,
  removeAgentAutonomyInterest,
  updateAgentAutonomySettings,
} from '../../core/agent-autonomy.js'
import { runAgentAutonomyTick } from '../../core/agent-autonomy-scheduler.js'
import { createChildLogger } from '../../core/logger.js'
import { agentStore } from '../../store/agents.js'
import { autonomyReportStore } from '../../store/autonomy-reports.js'
import { sessionManager } from '../../core/sessions.js'
import type { RpcHandlerMap } from './types.js'

const log = createChildLogger('rpc:autonomy')

export const autonomyRpcHandlers: RpcHandlerMap = {
  'autonomy.list'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = requiredText(msg.projectId, 'projectId')
    sendResult(listProjectAutonomyStates(projectId))
  },

  'autonomy.get'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const agentId = requireProjectAgent(msg.agentId, msg.projectId)
    sendResult(getAgentAutonomyState(agentId))
  },

  async 'autonomy.enable'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const agentId = requireProjectAgent(msg.agentId, msg.projectId)
    sendResult(await enableAgentAutonomy(agentId))
  },

  async 'autonomy.disable'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const agentId = requireProjectAgent(msg.agentId, msg.projectId)
    sendResult(await disableAgentAutonomy(agentId))
  },

  async 'autonomy.update'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const agentId = requireProjectAgent(msg.agentId, msg.projectId)
    const prompt = optionalText(msg.prompt, 'prompt', 20_000)
    const interests = optionalStringArray(msg.interests, 'interests', 50, 1_000)
    if (prompt === undefined && interests === undefined) throw new Error('至少需要更新 prompt 或 interests')
    sendResult(await updateAgentAutonomySettings(agentId, { prompt, interests }))
  },

  'autonomy.interest.add'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const agentId = requireProjectAgent(msg.agentId, msg.projectId)
    sendResult(addAgentAutonomyInterest(agentId, requiredText(msg.text, 'text', 1_000)))
  },

  'autonomy.interest.remove'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const agentId = requireProjectAgent(msg.agentId, msg.projectId)
    sendResult(removeAgentAutonomyInterest(agentId, requiredText(msg.interestId, 'interestId', 100)))
  },

  'autonomy.runNow'(msg, { sendResult, state: clientState }) {
    requireOwner(clientState.authMode)
    const agentId = requireProjectAgent(msg.agentId, msg.projectId)
    const state = getAgentAutonomyState(agentId)
    if (!state.config.enabled) throw new Error('请先启用自主模式')
    if (!state.session) throw new Error('自主 Session 不存在')
    if (sessionManager.isPromptPending(state.session.id)) throw new Error('自主 Session 正在运行，请等待本轮完成')
    void runAgentAutonomyTick(agentId, state.session.id, { force: true }).catch((err: unknown) => {
      log.error({ err, agentId, sessionId: state.session?.id }, 'Manual autonomy run failed')
    })
    sendResult({ accepted: true, sessionId: state.session.id })
  },

  'autonomy.reports.list'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = requiredText(msg.projectId, 'projectId')
    const agentId = typeof msg.agentId === 'string' && msg.agentId.trim()
      ? requireProjectAgent(msg.agentId, projectId)
      : undefined
    const before = optionalText(msg.before, 'before', 64)
    const limit = optionalInteger(msg.limit, 1, 100)
    sendResult(autonomyReportStore.list(projectId, { agentId, before, limit }))
  },
}

function requireOwner(authMode: 'owner' | 'guest'): void {
  if (authMode !== 'owner') throw new Error('访客无权访问自主 Agent')
}

function requireProjectAgent(value: unknown, projectValue: unknown): string {
  const agentId = requiredText(value, 'agentId')
  const projectId = typeof projectValue === 'string' && projectValue.trim()
    ? projectValue.trim()
    : undefined
  const agent = agentStore.get(agentId)
  if (!agent?.project_id) throw new Error(`项目 Agent 不存在: ${agentId}`)
  if (projectId && agent.project_id !== projectId) throw new Error('Agent 不属于当前项目')
  return agentId
}

function requiredText(value: unknown, field: string, maxLength?: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (maxLength && text.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return text
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`)
  if (value.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return value
}

function optionalStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field} 必须是最多 ${maxItems} 项的数组`)
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, maxLength))
}

function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`limit 必须是 ${min}-${max} 的整数`)
  }
  return value
}
