import { sessionStore, messageStore, eventStore, type SessionRow } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { agentStore } from '../store/agents.js'
import { projectStore } from '../store/projects.js'
import { acpHost } from '../acp/host.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import type { ImageAttachment, SessionUpdateData, ToolCallData } from '../types/ws-protocol.js'
import { upsertToolCall } from './tool-calls.js'

const log = createChildLogger('session')

interface PendingMessage { content: string; thinking: string; toolCalls: ToolCallData[] }
const pendingBySession = new Map<string, PendingMessage>()
const activePrompts = new Set<string>()

events.on('session:update', (ev) => {
  const { sessionId, data } = ev
  let pending = pendingBySession.get(sessionId)
  if (!pending) { pending = { content: '', thinking: '', toolCalls: [] }; pendingBySession.set(sessionId, pending) }

  if (data.contentDelta) pending.content += data.contentDelta
  if (data.thinking) pending.thinking += data.thinking
  if (data.toolCall) pending.toolCalls.push(data.toolCall)
  if (data.toolCallUpdate) pending.toolCalls = upsertToolCall(pending.toolCalls, data.toolCallUpdate)
})

events.on('session:update', (ev) => {
  const payload = eventPayloadFromUpdate(ev.data)
  if (!payload) return
  if (ev.data.sessionInfo?.title) {
    const updated = sessionStore.updateTitleIfEmpty(ev.sessionId, ev.data.sessionInfo.title)
    if (updated) events.emit('session:changed', { sessionId: ev.sessionId, data: { ...updated } })
  }
  const stored = eventStore.append(ev.sessionId, {
    type: payload.type,
    agentId: ev.agentId,
    messageId: ev.data.messageId,
    role: ev.data.role,
    payload: payload.payload,
  })
  events.emit('session:event', { sessionId: ev.sessionId, agentId: ev.agentId, event: stored })
})

events.on('session:done', (ev) => {
  const stored = eventStore.append(ev.sessionId, {
    type: 'message.done',
    agentId: ev.agentId,
    messageId: ev.messageId,
    role: 'agent',
    payload: { messageId: ev.messageId, turnUsage: ev.turnUsage, stopReason: ev.stopReason, error: ev.error },
  })
  events.emit('session:event', { sessionId: ev.sessionId, agentId: ev.agentId, event: stored })
})

function eventPayloadFromUpdate(data: SessionUpdateData): { type: string; payload: unknown } | null {
  if (data.eventType === 'permission.result') return { type: 'permission.result', payload: { requestId: data.messageId, cancelled: true } }
  if (data.eventType === 'elicitation.result') return { type: 'elicitation.result', payload: { requestId: data.messageId, action: 'cancel' } }
  if (data.contentDelta || data.content) return { type: data.eventType || 'message.chunk', payload: { messageId: data.messageId, role: data.role, contentDelta: data.contentDelta, content: data.content } }
  if (data.thinking) return { type: 'thinking.chunk', payload: { messageId: data.messageId, thinking: data.thinking } }
  if (data.toolCall) return { type: 'tool.call', payload: { messageId: data.messageId, toolCall: data.toolCall } }
  if (data.toolCallUpdate) return { type: 'tool.update', payload: { messageId: data.messageId, toolCall: data.toolCallUpdate } }
  if (data.usage) return { type: 'usage.update', payload: { usage: data.usage } }
  if (data.plan) return { type: 'plan.update', payload: { plan: data.plan } }
  if (data.configOptions) return { type: 'config.update', payload: { configOptions: data.configOptions } }
  if (data.commands) return { type: 'commands.update', payload: { commands: data.commands } }
  if (data.sessionInfo) return { type: 'session.info', payload: { sessionInfo: data.sessionInfo } }
  if (data.permissionRequest) return { type: 'permission.request', payload: { permissionRequest: data.permissionRequest } }
  if (data.elicitationRequest) return { type: 'elicitation.request', payload: { elicitationRequest: data.elicitationRequest } }
  if (data.attachments) return { type: 'message.attachments', payload: { messageId: data.messageId, attachments: data.attachments } }
  return null
}

events.on('session:done', (ev) => {
  const pending = pendingBySession.get(ev.sessionId)
  if (pending && (pending.content || pending.thinking || pending.toolCalls.length > 0)) {
    const message = messageStore.append(ev.sessionId, {
      role: 'agent',
      content: pending.content,
      thinking: pending.thinking || undefined,
      toolCalls: pending.toolCalls.length > 0 ? pending.toolCalls : undefined,
    })
    sessionStore.touch(ev.sessionId, message.timestamp)
  }
  pendingBySession.delete(ev.sessionId)
})

events.on('session:done', (ev) => {
  const session = sessionStore.get(ev.sessionId)
  if (!session?.task_id) return

  const task = taskStore.get(session.task_id)
  if (!task || task.status !== 'executing') return

  const stage = 'Agent 已完成，等待人工确认'
  taskStore.updateStatus(task.id, 'reviewing', stage)
  events.emit('task:update', {
    taskId: task.id,
    data: { ...taskStore.get(task.id), event: 'agent_completed' },
  })
})

export const sessionManager = {
  async createSession(agentId: string, taskId?: string, projectId?: string): Promise<SessionRow> {
    const agent = agentStore.get(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)
    const projectContext = resolveSessionProjectContext(agentId, taskId, projectId)

    const session = sessionStore.create({ agentId, taskId, projectId: projectContext.projectId })

    log.info({ sessionId: session.id, agentId, taskId, projectId: projectContext.projectId }, 'Local Session created')
    return session
  },

  async sendPrompt(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (activePrompts.has(sessionId)) throw new Error('当前会话正在生成中，请等待本轮完成或先停止生成')

    const promptLen = content.length
    const imageCount = images?.length ?? 0
    log.debug({ sessionId, agentId: session.agent_id, promptLen, imageCount }, 'send prompt')

    activePrompts.add(sessionId)
    try {
      const humanMessage = messageStore.append(sessionId, { role: 'human', content, attachments: images })
      sessionStore.touch(sessionId, humanMessage.timestamp)
      const stored = eventStore.append(sessionId, {
        type: 'message.user',
        agentId: session.agent_id,
        messageId: humanMessage.id,
        role: 'human',
        payload: { messageId: humanMessage.id, content, attachments: images || [] },
      })
      events.emit('session:event', { sessionId, agentId: session.agent_id, event: stored })
      emitLifecycle(session.agent_id, sessionId, 'lifecycle.prompt_received', '\u6b63\u5728\u51c6\u5907 Agent...')

      const projectContext = resolveSessionProjectContext(session.agent_id, session.task_id ?? undefined, session.project_id ?? undefined)
      const acpSessionId = await acpHost.ensureSession(session.agent_id, sessionId, session.acp_session_id, projectContext)
      if (session.acp_session_id !== acpSessionId) {
        sessionStore.updateAcpSessionId(sessionId, acpSessionId)
        log.info({ sessionId, acpSessionId }, 'ACP Session mapped')
      }
      emitLifecycle(session.agent_id, sessionId, 'lifecycle.prompt_sent', '\u6b63\u5728\u601d\u8003...')
      await acpHost.prompt(session.agent_id, sessionId, content, images)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emitLifecycle(session.agent_id, sessionId, 'lifecycle.failed', `\u6267\u884c\u5931\u8d25\uff1a${message}`)
      log.error({ err, sessionId, agentId: session.agent_id }, 'prompt failed')
      events.emit('session:done', { sessionId, agentId: session.agent_id, messageId: `error-${Date.now()}`, stopReason: 'error', error: message })
      throw err
    } finally {
      activePrompts.delete(sessionId)
    }
  },

  async sendDecision(sessionId: string, _messageId: string, _choice: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error(`Session 不存在: ${sessionId}`)
    // TODO: implement ACP decision forwarding
  },

  async closeSession(sessionId: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) return

    await acpHost.closeSession(session.agent_id, sessionId)
    sessionStore.updateStatus(sessionId, 'closed')
    const updated = sessionStore.get(sessionId)
    if (updated) events.emit('session:changed', { sessionId, data: { ...updated } })
    log.info({ sessionId, agentId: session.agent_id }, 'Session 已关闭')
  },

  renameSession(sessionId: string, title: string): SessionRow {
    const session = sessionStore.updateTitle(sessionId, title)
    if (!session) throw new Error(`Session 不存在: ${sessionId}`)
    events.emit('session:changed', { sessionId, data: { ...session } })
    log.info({ sessionId, title: session.title }, 'Session 已重命名')
    return session
  },

  archiveSession(sessionId: string): SessionRow {
    const session = sessionStore.archive(sessionId)
    if (!session) throw new Error(`Session 不存在: ${sessionId}`)
    events.emit('session:changed', { sessionId, data: { ...session, event: 'archived' } })
    log.info({ sessionId }, 'Session 已归档')
    return session
  },

  async deleteSession(sessionId: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) return
    await acpHost.closeSession(session.agent_id, sessionId)
    sessionStore.delete(sessionId)
    events.emit('session:changed', { sessionId, data: { event: 'deleted', deleted: true } })
    log.info({ sessionId, agentId: session.agent_id }, 'Session 已删除')
  },
}

function emitLifecycle(agentId: string, sessionId: string, eventType: string, content: string): void {
  sessionStore.updateStage(sessionId, content)
  const updated = sessionStore.get(sessionId)
  if (updated) events.emit('session:changed', { sessionId, data: { ...updated } })
  events.emit('session:update', {
    sessionId,
    agentId,
    data: { messageId: `${eventType}-${Date.now()}`, role: 'system', content, eventType } satisfies SessionUpdateData,
  })
}

function resolveSessionProjectContext(agentId: string, taskId?: string, existingProjectId?: string): { projectId?: string; cwd?: string } {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  const task = taskId ? taskStore.get(taskId) : undefined
  if (taskId && !task) throw new Error(`Task not found: ${taskId}`)

  const projectIds = [existingProjectId, agent.project_id ?? undefined, task?.project_id ?? undefined].filter(Boolean)
  const projectId = projectIds[0]
  if (projectId && projectIds.some(id => id !== projectId)) {
    throw new Error(`Project mismatch between agent/task/session: ${projectIds.join(', ')}`)
  }
  if (!projectId) return {}

  const project = projectStore.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return { projectId, cwd: project.work_dir }
}
