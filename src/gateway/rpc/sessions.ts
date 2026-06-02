import { acpHost } from '../../acp/host.js'
import { events } from '../../core/events.js'
import { createChildLogger } from '../../core/logger.js'
import { sessionManager } from '../../core/sessions.js'
import { projectStore } from '../../store/projects.js'
import { eventStore, messageStore, sessionStore } from '../../store/sessions.js'
import { parseToolCallsJson, selectToolCallDetail, summarizeToolCalls } from '../../store/tool-call-history.js'
import type { RpcHandlerMap } from './types.js'

const log = createChildLogger('rpc-sessions')

function resolveSessionProjectContext(sessionId: string): { projectId?: string; cwd?: string } {
  const session = sessionStore.get(sessionId)
  if (!session) return {}
  const project = session.project_id ? projectStore.get(session.project_id) : undefined
  return { projectId: session.project_id ?? undefined, cwd: project?.work_dir }
}

async function ensureAcpSession(sessionId: string): Promise<{ agentId: string }> {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error('会话不存在')
  const context = resolveSessionProjectContext(sessionId)
  const acpSessionId = await acpHost.ensureSession(session.agent_id, sessionId, session.acp_session_id, context)
  if (session.acp_session_id !== acpSessionId) sessionStore.updateAcpSessionId(sessionId, acpSessionId)
  return { agentId: session.agent_id }
}

function getSessionMessage(sessionId: string, messageId: string) {
  const message = messageStore.get(messageId)
  if (!message || message.session_id !== sessionId) throw new Error('消息不存在')
  return message
}
export const sessionRpcHandlers: RpcHandlerMap = {
  async 'session.setModel'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const modelId = msg.modelId as string
    const { agentId } = await ensureAcpSession(sessionId)
    await acpHost.setModel(agentId, sessionId, modelId)
    sendResult({ modelId })
  },

  'session.getModels'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error('会话不存在')
    const caps = acpHost.getSessionCapabilities(session.agent_id, sessionId)
    sendResult({
      models: caps?.models || [],
      currentModelId: caps?.currentModelId || null,
      modes: caps?.modes || [],
      currentModeId: caps?.currentModeId || null,
      supportsImages: caps?.supportsImages || false,
      supportsAudio: caps?.supportsAudio || false,
      configOptions: caps?.configOptions || [],
      commands: caps?.commands || [],
      sessionInfo: caps?.sessionInfo || null,
    })
  },

  async 'session.setMode'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const modeId = msg.modeId as string
    const { agentId } = await ensureAcpSession(sessionId)
    await acpHost.setMode(agentId, sessionId, modeId)
    sendResult({ modeId })
  },

  async 'session.setConfig'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const configId = msg.configId as string
    const value = msg.value as string | boolean
    const { agentId } = await ensureAcpSession(sessionId)
    await acpHost.setConfig(agentId, sessionId, configId, value)
    sendResult({ configId, value })
  },

  async 'session.fork'(msg, { state, sendResult }) {
    const sessionId = msg.sessionId as string
    const source = sessionStore.get(sessionId)
    if (!source) throw new Error('会话不存在')
    const forked = sessionStore.create({ agentId: source.agent_id, taskId: source.task_id ?? undefined, projectId: source.project_id ?? undefined })
    try {
      const project = source.project_id ? projectStore.get(source.project_id) : undefined
      const acpSessionId = await acpHost.forkSession(source.agent_id, sessionId, forked.id, {
        projectId: source.project_id ?? undefined,
        cwd: project?.work_dir,
      })
      sessionStore.updateAcpSessionId(forked.id, acpSessionId)
      state.subscriptions.add(forked.id)
      sendResult(sessionStore.get(forked.id))
    } catch (err) {
      sessionStore.updateStatus(forked.id, 'closed')
      throw new Error(err instanceof Error ? err.message : 'fork 会话失败', { cause: err })
    }
  },

  'permission.respond'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const ok = acpHost.resolvePermission(sessionId, msg.permissionRequestId as string, msg.optionId as string | undefined, msg.cancelled as boolean | undefined)
    if (!ok) throw new Error('权限请求已失效')
    const session = sessionStore.get(sessionId)
    const stored = eventStore.append(sessionId, {
      type: 'permission.result',
      agentId: session?.agent_id,
      messageId: msg.permissionRequestId as string,
      role: 'system',
      payload: { requestId: msg.permissionRequestId, optionId: msg.optionId, cancelled: msg.cancelled === true },
    })
    events.emit('session:event', { sessionId, agentId: session?.agent_id, event: stored })
    sendResult({ ok: true })
  },

  'elicitation.respond'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const ok = acpHost.resolveElicitation(sessionId, msg.elicitationRequestId as string, msg.action as 'accept' | 'decline' | 'cancel', msg.content as Record<string, string | number | boolean | string[]> | undefined)
    if (!ok) throw new Error('提问请求已失效')
    const session = sessionStore.get(sessionId)
    const stored = eventStore.append(sessionId, {
      type: 'elicitation.result',
      agentId: session?.agent_id,
      messageId: msg.elicitationRequestId as string,
      role: 'system',
      payload: { requestId: msg.elicitationRequestId, action: msg.action, content: msg.content },
    })
    events.emit('session:event', { sessionId, agentId: session?.agent_id, event: stored })
    sendResult({ ok: true })
  },

  async 'session.cancel'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error('会话不存在')
    await acpHost.cancelPrompt(session.agent_id, sessionId)
    sendResult({ ok: true })
    setTimeout(() => {
      const conn = acpHost.agents.get(session.agent_id)
      if (!conn) return
      const rs = conn.runtimeSessions.get(sessionId)
      if (rs && rs.activeTurnCount > 0) {
        log.warn({ sessionId, agentId: session.agent_id }, 'cancel timeout: forcing done after 10s')
        rs.activeTurnCount = 0
        conn.activeTurnCount = Math.max(0, conn.activeTurnCount - 1)
        events.emit('session:done', { sessionId, agentId: session.agent_id, messageId: `cancel-timeout-${Date.now()}`, stopReason: 'cancelled' })
      }
    }, 10_000)
  },

  'sessions.list'(msg, { sendResult }) {
    sendResult(sessionStore.list(msg.agentId as string | undefined, msg.projectId as string | undefined))
  },

  async 'sessions.create'(msg, { state, sendResult }) {
    const session = await sessionManager.createSession(msg.agentId as string, msg.taskId as string | undefined, msg.projectId as string | undefined)
    state.subscriptions.add(session.id)
    sendResult(session)
  },

  'sessions.rename'(msg, { sendResult }) {
    sendResult(sessionManager.renameSession(msg.sessionId as string, msg.title as string))
  },

  async 'sessions.close'(msg, { sendResult }) {
    await sessionManager.closeSession(msg.sessionId as string)
    sendResult(sessionStore.get(msg.sessionId as string))
  },

  'sessions.archive'(msg, { sendResult }) {
    sendResult(sessionManager.archiveSession(msg.sessionId as string))
  },

  async 'sessions.delete'(msg, { state, sendResult }) {
    await sessionManager.deleteSession(msg.sessionId as string)
    state.subscriptions.delete(msg.sessionId as string)
    sendResult({ deleted: true })
  },

  'sessions.messages'(msg, { sendResult }) {
    sendResult(messageStore.list(msg.sessionId as string, {
      limit: msg.limit as number | undefined,
      before: msg.before as string | undefined,
      includeToolCalls: msg.includeToolCalls as boolean | undefined,
      includeLatestToolCalls: msg.includeLatestToolCalls as boolean | undefined,
    }))
  },

  'sessions.messageToolCalls'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const message = getSessionMessage(sessionId, msg.messageId as string)
    sendResult(summarizeToolCalls(parseToolCallsJson(message.tool_calls_json)))
  },

  'sessions.messageToolCallDetail'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const message = getSessionMessage(sessionId, msg.messageId as string)
    const detail = selectToolCallDetail(parseToolCallsJson(message.tool_calls_json), msg.toolCallId as string)
    if (!detail) throw new Error('工具调用不存在')
    sendResult(detail)
  },

  'sessions.events'(msg, { sendResult }) {
    sendResult(eventStore.list(msg.sessionId as string, { limit: msg.limit as number | undefined, afterSequence: msg.afterSequence as number | undefined }))
  },
}
