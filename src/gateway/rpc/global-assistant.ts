import { isSupportedAgentRuntime, SUPPORTED_AGENT_RUNTIMES } from '../../acp/adapters.js'
import { createChildLogger } from '../../core/logger.js'
import { agentStore, type AgentRow } from '../../store/agents.js'
import { templateStore } from '../../store/agent-templates.js'
import { globalAssistantStore, type GlobalAssistantRow } from '../../store/global-assistant.js'
import { modelProfileStore } from '../../store/model-profiles.js'
import { sessionStore, type SessionRow } from '../../store/sessions.js'
import type { RpcHandlerMap } from './types.js'

const log = createChildLogger('rpc-global-assistant')

export interface GlobalAssistantPayload {
  assistant: GlobalAssistantRow
  agent: AgentRow
  session: SessionRow
}

export const globalAssistantRpcHandlers: RpcHandlerMap = {
  'globalAssistant.get'(_msg, { sendResult }) {
    sendResult(readGlobalAssistantPayload())
  },

  'globalAssistant.setTemplate'(msg, { sendResult }) {
    const templateId = msg.templateId as string
    const existing = readGlobalAssistantPayload()
    const template = templateStore.get(templateId)
    if (!template) throw new Error(`Agent 模板不存在: ${templateId}`)

    const runtime = (msg.runtime as string | undefined) || template.runtime
    if (!isSupportedAgentRuntime(runtime)) {
      throw new Error(`不支持的 Agent runtime: ${runtime || '空'}。当前仅支持 ${SUPPORTED_AGENT_RUNTIMES.join('|')}`)
    }

    const modelProfileId = normalizeModelProfileId(msg.modelProfileId)
    if (modelProfileId) ensureModelProfileMatches(modelProfileId, runtime)

    if (existing?.agent.template_id === templateId && existing.session.deleted_at == null) {
      const agent = agentStore.update(existing.agent.id, {
        name: readOptionalName(msg.name) ?? existing.agent.name,
        runtime,
        systemPrompt: typeof msg.systemPrompt === 'string' ? msg.systemPrompt : existing.agent.system_prompt,
        config: buildAgentConfig(template.id, template.skills_json, modelProfileId, existing.agent.config_json),
      })
      if (!agent) throw new Error(`Agent 不存在: ${existing.agent.id}`)
      sendResult({ ...existing, agent } satisfies GlobalAssistantPayload)
      return
    }

    const agent = agentStore.create({
      name: readOptionalName(msg.name) ?? template.name,
      type: template.type,
      runtime,
      templateId: template.id,
      systemPrompt: typeof msg.systemPrompt === 'string' ? msg.systemPrompt : template.system_prompt,
      icon: template.icon,
      config: buildAgentConfig(template.id, template.skills_json, modelProfileId),
    })
    const session = sessionStore.create({ agentId: agent.id })
    const titledSession = sessionStore.updateTitle(session.id, '全局助理') ?? session
    const assistant = globalAssistantStore.upsert({ agentId: agent.id, sessionId: session.id })

    log.info(
      { agentId: agent.id, sessionId: session.id, templateId: template.id, workspaceDir: assistant.workspace_dir },
      'global assistant configured',
    )
    sendResult({ assistant, agent, session: titledSession } satisfies GlobalAssistantPayload)
  },

  'globalAssistant.touch'(_msg, { sendResult }) {
    globalAssistantStore.touch()
    sendResult(readGlobalAssistantPayload())
  },
}

function readGlobalAssistantPayload(): GlobalAssistantPayload | null {
  const assistant = globalAssistantStore.get()
  if (!assistant || assistant.enabled !== 1) return null
  const agent = agentStore.get(assistant.agent_id)
  const session = sessionStore.get(assistant.session_id)
  if (!agent || !session || session.deleted_at) return null
  return { assistant, agent, session }
}

function parseSkills(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function normalizeModelProfileId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function ensureModelProfileMatches(modelProfileId: string, runtime: string): void {
  const profile = modelProfileStore.get(modelProfileId)
  if (!profile) throw new Error(`模型档案不存在: ${modelProfileId}`)
  if (profile.enabled !== 1) throw new Error('模型档案已禁用')
  if (profile.runtime !== runtime) throw new Error('模型档案运行时与 Agent 运行时不匹配')
}

function buildAgentConfig(
  templateId: string,
  skillsJson: string | null,
  modelProfileId?: string | null,
  currentRaw?: string | null,
): Record<string, unknown> {
  const current = parseConfig(currentRaw)
  const config: Record<string, unknown> = {
    ...current,
    templateId,
    skills: parseSkills(skillsJson),
  }
  if (modelProfileId !== undefined) {
    if (modelProfileId) config.modelProfileId = modelProfileId
    else delete config.modelProfileId
  }
  return config
}

function parseConfig(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readOptionalName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
