import { isSupportedAgentRuntime, SUPPORTED_AGENT_RUNTIMES } from '../../acp/adapters.js'
import { createChildLogger } from '../../core/logger.js'
import { agentStore, type AgentRow } from '../../store/agents.js'
import { templateStore } from '../../store/agent-templates.js'
import { globalAssistantStore, type GlobalAssistantRow } from '../../store/global-assistant.js'
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
    if (existing?.agent.template_id === templateId && existing.session.deleted_at == null) {
      sendResult(existing)
      return
    }

    const template = templateStore.get(templateId)
    if (!template) throw new Error(`Agent 模板不存在: ${templateId}`)
    if (!isSupportedAgentRuntime(template.runtime)) {
      throw new Error(`不支持的 Agent runtime: ${template.runtime || '空'}。当前仅支持 ${SUPPORTED_AGENT_RUNTIMES.join('|')}`)
    }

    const agent = agentStore.create({
      name: template.name,
      type: template.type,
      runtime: template.runtime,
      templateId: template.id,
      systemPrompt: template.system_prompt,
      icon: template.icon,
      config: {
        templateId: template.id,
        skills: parseSkills(template.skills_json),
      },
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
