import { agentStore, type AgentRow } from '../store/agents.js'
import { ruleStore } from '../store/rules.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { getRuntimePort } from '../runtime/runtime-port-provider.js'
import { configureSessionRuntime } from './session-runtime-control.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { publishSessionCreated } from './session-change-events.js'
import { sessionManager } from './sessions.js'
import {
  createAutonomyInterest,
  getAgentAutonomyConfig,
  updateAgentAutonomyConfig,
  type AgentAutonomyConfig,
  type AutonomyPlanItem,
} from './agent-autonomy-config.js'
import {
  ensureAutonomyMemory,
  readAutonomyMemory,
  readAutonomyMemoryMetadata,
  type AutonomyMemoryData,
} from './agent-autonomy-memory.js'

const log = createChildLogger('agent-autonomy')

export interface AgentAutonomyState {
  agentId: string
  projectId: string
  runtime: string
  config: AgentAutonomyConfig
  session: SessionRow | null
  memory: AutonomyMemoryData
}

export async function enableAgentAutonomy(agentId: string): Promise<AgentAutonomyState> {
  const agent = requireProjectAgent(agentId)
  const memory = ensureAutonomyMemory(agent.project_id, agent.id)
  const session = ensureAutonomySession(agent.id, agent.project_id)
  updateAgentAutonomyConfig(agent.id, {
    autonomySessionId: session.id,
    memoryPath: memory.path,
    dirty: true,
    lastError: null,
    plan: { nextCheckAt: new Date().toISOString() },
  })
  await ensurePrivilegedMode(session.id, agent.runtime)
  const ruleId = ensureHeartbeatRule(agent.id, agent.project_id, session.id)
  updateAgentAutonomyConfig(agent.id, { enabled: true, heartbeatRuleId: ruleId })
  events.emit('autonomy:update', { agentId, projectId: agent.project_id })
  log.info({ agentId, projectId: agent.project_id, sessionId: session.id, ruleId }, 'Agent autonomy enabled')
  return getAgentAutonomyState(agentId)
}

export async function disableAgentAutonomy(agentId: string): Promise<AgentAutonomyState> {
  const agent = requireProjectAgent(agentId)
  const config = getAgentAutonomyConfig(agentId)
  if (config.heartbeatRuleId && ruleStore.get(config.heartbeatRuleId)) {
    ruleStore.toggle(config.heartbeatRuleId, false)
    events.emit('rule:update', { ruleId: config.heartbeatRuleId, data: { enabled: false } })
  }
  updateAgentAutonomyConfig(agentId, { enabled: false, dirty: false, lastSkipReason: 'disabled' })
  const session = resolveAutonomySession(agentId, config.autonomySessionId)
  if (session && sessionManager.isPromptActive(session.id)) {
    await getRuntimePort().cancelPrompt(agentId, session.id).catch((err: unknown) => {
      log.warn({ err, agentId, sessionId: session.id }, 'Failed to cancel active autonomy Prompt while disabling')
    })
  }
  events.emit('autonomy:update', { agentId, projectId: agent.project_id })
  log.info({ agentId, projectId: agent.project_id, sessionId: session?.id }, 'Agent autonomy disabled')
  return getAgentAutonomyState(agentId)
}

export async function updateAgentAutonomySettings(
  agentId: string,
  input: { prompt?: string; interests?: string[] },
): Promise<AgentAutonomyState> {
  const agent = requireProjectAgent(agentId)
  const current = getAgentAutonomyConfig(agentId)
  const patch: Parameters<typeof updateAgentAutonomyConfig>[1] = {}
  const promptChanged = input.prompt !== undefined && input.prompt !== current.prompt
  if (input.prompt !== undefined) {
    patch.prompt = input.prompt
    patch.promptRevision = promptChanged ? current.promptRevision + 1 : current.promptRevision
  }
  if (input.interests !== undefined) {
    patch.interests = uniqueInterestTexts(input.interests).map((text) => createAutonomyInterest(text))
    patch.dirty = true
    patch.plan = { nextCheckAt: new Date().toISOString() }
  }
  const next = updateAgentAutonomyConfig(agentId, patch)
  if (promptChanged) await requestAutonomyRuntimeRestart(agentId, next.autonomySessionId)
  events.emit('autonomy:update', { agentId, projectId: agent.project_id })
  return getAgentAutonomyState(agentId)
}

export function addAgentAutonomyInterest(agentId: string, text: string): AgentAutonomyState {
  const agent = requireProjectAgent(agentId)
  const value = text.trim()
  if (!value) throw new Error('关注点不能为空')
  const current = getAgentAutonomyConfig(agentId)
  if (current.interests.some((item) => item.text.toLocaleLowerCase() === value.toLocaleLowerCase())) {
    throw new Error('关注点已存在')
  }
  if (current.interests.length >= 50) throw new Error('关注点最多 50 项')
  updateAgentAutonomyConfig(agentId, {
    interests: [...current.interests, createAutonomyInterest(value)],
    dirty: true,
    plan: { nextCheckAt: new Date().toISOString() },
  })
  events.emit('autonomy:update', { agentId, projectId: agent.project_id })
  return getAgentAutonomyState(agentId)
}

export function removeAgentAutonomyInterest(agentId: string, interestId: string): AgentAutonomyState {
  const agent = requireProjectAgent(agentId)
  const current = getAgentAutonomyConfig(agentId)
  updateAgentAutonomyConfig(agentId, {
    interests: current.interests.filter((item) => item.id !== interestId),
    dirty: true,
    plan: { nextCheckAt: new Date().toISOString() },
  })
  events.emit('autonomy:update', { agentId, projectId: agent.project_id })
  return getAgentAutonomyState(agentId)
}

export function updateAgentAutonomyPlan(
  agentId: string,
  input: { date: string; items: AutonomyPlanItem[]; nextCheckAt?: string },
): AgentAutonomyConfig {
  const agent = requireProjectAgent(agentId)
  validatePlan(input.items)
  const nextCheckAt = normalizeNextCheckAt(input.nextCheckAt)
  const config = updateAgentAutonomyConfig(agentId, {
    plan: {
      date: input.date,
      items: input.items.map((item) => ({ ...item })),
      nextCheckAt,
      updatedAt: new Date().toISOString(),
    },
    dirty: false,
    lastError: null,
  })
  events.emit('autonomy:update', { agentId, projectId: agent.project_id })
  return config
}

export function getAgentAutonomyState(
  agentId: string,
  options: { includeMemoryContent?: boolean } = { includeMemoryContent: true },
): AgentAutonomyState {
  const agent = requireProjectAgent(agentId)
  const config = getAgentAutonomyConfig(agentId)
  const session = resolveAutonomySession(agentId, config.autonomySessionId) ?? null
  return {
    agentId,
    projectId: agent.project_id,
    runtime: agent.runtime,
    config,
    session,
    memory: options.includeMemoryContent === false
      ? readAutonomyMemoryMetadata(agent.project_id, agent.id)
      : readAutonomyMemory(agent.project_id, agent.id),
  }
}

export function listProjectAutonomyStates(projectId: string): AgentAutonomyState[] {
  return agentStore.list(projectId).map((agent) => getAgentAutonomyState(agent.id, { includeMemoryContent: false }))
}

async function requestAutonomyRuntimeRestart(agentId: string, configuredSessionId: string | null): Promise<void> {
  const session = resolveAutonomySession(agentId, configuredSessionId)
  if (!session?.acp_session_id) return
  if (sessionManager.isPromptPending(session.id)) {
    updateAgentAutonomyConfig(agentId, { restartPending: true })
    return
  }
  await resetAutonomyRuntime(agentId, session.id)
}

export async function resetAutonomyRuntime(agentId: string, sessionId: string): Promise<void> {
  await getRuntimePort().closeSession(agentId, sessionId)
  sessionStore.clearAcpSessionId(sessionId)
  updateAgentAutonomyConfig(agentId, { restartPending: false })
  const updated = sessionStore.get(sessionId)
  if (updated) events.emit('session:changed', { sessionId, data: { ...updated } })
  log.info({ agentId, sessionId }, 'Autonomy ACP context reset')
}

function ensureAutonomySession(agentId: string, projectId: string): SessionRow {
  const existing = sessionStore.findAutonomyByAgent(agentId)
  if (existing) return existing
  return publishSessionCreated(sessionStore.create({
    agentId,
    projectId,
    purpose: 'autonomy',
    title: '自主运行',
  }))
}

function resolveAutonomySession(agentId: string, configuredSessionId: string | null): SessionRow | undefined {
  const configured = configuredSessionId ? sessionStore.get(configuredSessionId) : undefined
  if (configured?.agent_id === agentId && configured.purpose === 'autonomy' && !configured.deleted_at) return configured
  return sessionStore.findAutonomyByAgent(agentId)
}

async function ensurePrivilegedMode(sessionId: string, runtime: string): Promise<void> {
  const desiredMode = runtime === 'claude'
    ? 'bypassPermissions'
    : runtime === 'codex'
      ? 'agent-full-access'
      : undefined
  if (!desiredMode) return
  const result = await configureSessionRuntime(sessionId, { modeId: desiredMode })
  if (result.applied.modeId !== desiredMode) {
    throw new Error(`自主特权模式未生效: requested=${desiredMode}, applied=${result.applied.modeId ?? 'none'}`)
  }
}

function ensureHeartbeatRule(agentId: string, projectId: string, sessionId: string): string {
  const config = getAgentAutonomyConfig(agentId)
  const current = config.heartbeatRuleId ? ruleStore.get(config.heartbeatRuleId) : undefined
  if (current) {
    ruleStore.update(current.id, {
      cron: '*/10 * * * *',
      enabled: true,
      action: 'autonomy_tick',
      action_config: { agent_id: agentId, session_id: sessionId },
    })
    return current.id
  }
  return ruleStore.create({
    name: `${agentStore.get(agentId)?.name ?? agentId} 自主检查`,
    description: '自主 Agent 固定检查',
    cron: '*/10 * * * *',
    action: 'autonomy_tick',
    actionConfig: { agent_id: agentId, session_id: sessionId },
    enabled: true,
    projectId,
    createdBy: `autonomy:${agentId}`,
  }).id
}

function requireProjectAgent(agentId: string): AgentRow & { project_id: string } {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent 不存在: ${agentId}`)
  if (!agent.project_id) throw new Error('自主模式仅支持项目 Agent')
  return agent as AgentRow & { project_id: string }
}

function validatePlan(items: AutonomyPlanItem[]): void {
  if (items.length > 20) throw new Error('排班最多 20 项')
  if (items.filter((item) => item.status === 'current').length > 1) throw new Error('排班最多一个 current 项')
  const ids = new Set<string>()
  for (const item of items) {
    if (!item.id.trim() || !item.title.trim()) throw new Error('排班项 id 和 title 不能为空')
    if (ids.has(item.id)) throw new Error(`排班项 id 重复: ${item.id}`)
    ids.add(item.id)
  }
}

function normalizeNextCheckAt(value: string | undefined): string {
  const now = Date.now()
  const fallback = now + 10 * 60 * 1000
  if (!value) return new Date(fallback).toISOString()
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('nextCheckAt 必须是有效 ISO 时间')
  return new Date(Math.min(Math.max(parsed, now), now + 24 * 60 * 60 * 1000)).toISOString()
}

function uniqueInterestTexts(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = value.trim()
    const key = text.toLocaleLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }
  if (result.length > 50) throw new Error('关注点最多 50 项')
  return result
}

events.on('session:done', (event) => {
  const session = sessionStore.get(event.sessionId)
  if (!session || session.purpose !== 'autonomy') return
  const config = getAgentAutonomyConfig(session.agent_id)
  if (!config.restartPending) return
  queueMicrotask(() => {
    void resetAutonomyRuntime(session.agent_id, session.id).catch((err: unknown) => {
      updateAgentAutonomyConfig(session.agent_id, {
        lastError: err instanceof Error ? err.message : String(err),
      })
      log.error({ err, agentId: session.agent_id, sessionId: session.id }, 'Deferred autonomy Runtime reset failed')
    })
  })
})
