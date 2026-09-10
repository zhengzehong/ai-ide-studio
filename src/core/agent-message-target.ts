import { agentStore } from '../store/agents.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { globalAssistantStore } from '../store/global-assistant.js'
import { sessionManager } from './sessions.js'

export async function resolveTargetSession(input: {
  sourceProjectId?: string
  targetAgentId?: string
  targetSessionId?: string
}): Promise<SessionRow> {
  if (!input.targetAgentId && !input.targetSessionId) throw new Error('targetAgentId 或 targetSessionId 至少需要一个')
  if (input.targetSessionId) {
    const session = requireMessageTargetSession(input.targetSessionId, input.sourceProjectId)
    if (input.targetAgentId && input.targetAgentId !== session.agent_id) throw new Error('targetAgentId 与 targetSessionId 不匹配')
    if (session.status !== 'active') throw new Error('目标会话已关闭')
    return session
  }
  const globalAssistantSession = getGlobalAssistantTargetSession(input.targetAgentId!, input.sourceProjectId)
  if (globalAssistantSession) {
    if (globalAssistantSession.status !== 'active') throw new Error('目标会话已关闭')
    return globalAssistantSession
  }
  const agent = agentStore.get(input.targetAgentId!)
  if (!agent) throw new Error('目标 Agent 不存在')
  if (input.sourceProjectId && agent.project_id !== input.sourceProjectId) throw new Error('目标 Agent 不属于当前项目')
  return sessionManager.createSession(input.targetAgentId!, undefined, input.sourceProjectId)
}

function requireMessageTargetSession(sessionId: string, projectId: string | undefined): SessionRow {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`Session 不存在: ${sessionId}`)
  if (projectId && session.project_id !== projectId && globalAssistantStore.getBySessionId(session.id)?.agent_id !== session.agent_id) {
    throw new Error('会话不属于当前项目')
  }
  return session
}

function getGlobalAssistantTargetSession(agentId: string, projectId: string | undefined): SessionRow | undefined {
  if (!projectId) return undefined
  const assistant = globalAssistantStore.get()
  if (!assistant || assistant.agent_id !== agentId) return undefined
  const session = sessionStore.get(assistant.session_id)
  if (!session || session.agent_id !== assistant.agent_id) return undefined
  return session
}
