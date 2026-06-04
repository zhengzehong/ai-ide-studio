import { sessionStore, messageStore, eventStore, type SessionRow } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { agentStore } from '../store/agents.js'
import { projectStore } from '../store/projects.js'
import { teamMemberStore } from '../store/teams.js'
import { acpHost } from '../acp/host.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import type { ImageAttachment, SessionActivityReason, SessionActivityState, SessionUpdateData } from '../types/ws-protocol.js'
import { createPendingTurn, finalizePendingTurn, updatePendingTurn, type PendingTurn } from './turn-finalizer.js'
import { buildTeamLeaderPrompt } from './team-prompts.js'
import { resolveVisiblePlatformTools } from '../tools/registry/visibility-resolver.js'

const log = createChildLogger('session')

const pendingBySession = new Map<string, PendingTurn>()
const activePrompts = new Set<string>()
const queuedPrompts = new Map<string, Promise<void>>()

events.on('session:update', (ev) => {
  const { sessionId, data } = ev
  let pending = pendingBySession.get(sessionId)
  if (!pending) {
    pending = createPendingTurn()
    pendingBySession.set(sessionId, pending)
  }

  pendingBySession.set(sessionId, updatePendingTurn(pending, data))
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

events.on('session:done', (ev) => {
  const updated = sessionStore.clearStageIfRunning(ev.sessionId)
  if (updated) events.emit('session:changed', { sessionId: ev.sessionId, data: { ...updated } })
})

function eventPayloadFromUpdate(data: SessionUpdateData): { type: string; payload: unknown } | null {
  if (data.eventType === 'permission.result')
    return { type: 'permission.result', payload: { requestId: data.messageId, cancelled: true } }
  if (data.eventType === 'elicitation.result')
    return { type: 'elicitation.result', payload: { requestId: data.messageId, action: 'cancel' } }
  if (data.contentDelta || data.content)
    return {
      type: data.eventType || 'message.chunk',
      payload: { messageId: data.messageId, role: data.role, contentDelta: data.contentDelta, content: data.content },
    }
  if (data.thinking) return { type: 'thinking.chunk', payload: { messageId: data.messageId, thinking: data.thinking } }
  if (data.toolCall) return { type: 'tool.call', payload: { messageId: data.messageId, toolCall: data.toolCall } }
  if (data.toolCallUpdate)
    return { type: 'tool.update', payload: { messageId: data.messageId, toolCall: data.toolCallUpdate } }
  if (data.usage) return { type: 'usage.update', payload: { usage: data.usage } }
  if (data.plan) return { type: 'plan.update', payload: { plan: data.plan } }
  if (data.configOptions) return { type: 'config.update', payload: { configOptions: data.configOptions } }
  if (data.commands) return { type: 'commands.update', payload: { commands: data.commands } }
  if (data.sessionInfo) return { type: 'session.info', payload: { sessionInfo: data.sessionInfo } }
  if (data.permissionRequest)
    return { type: 'permission.request', payload: { permissionRequest: data.permissionRequest } }
  if (data.elicitationRequest)
    return { type: 'elicitation.request', payload: { elicitationRequest: data.elicitationRequest } }
  if (data.attachments)
    return { type: 'message.attachments', payload: { messageId: data.messageId, attachments: data.attachments } }
  return null
}

events.on('session:done', (ev) => {
  const pending = pendingBySession.get(ev.sessionId)
  const finalized = pending ? finalizePendingTurn(pending) : null
  if (finalized) {
    const message = messageStore.append(ev.sessionId, {
      id: finalized.messageId,
      role: 'agent',
      content: finalized.content,
      thinking: finalized.thinking || undefined,
      toolCalls: finalized.toolCalls,
    })
    sessionStore.touch(ev.sessionId, message.timestamp)
  } else if (ev.stopReason === 'error' && ev.error) {
    const message = messageStore.append(ev.sessionId, {
      id: ev.messageId,
      role: 'agent',
      content: `执行失败：${ev.error}`,
    })
    sessionStore.touch(ev.sessionId, message.timestamp)
  }
  pendingBySession.delete(ev.sessionId)
})

// BR-03: 系统不因 session:done 自动改变任务状态，由 Agent 通过 studio.task.* 工具主动管理

export const sessionManager = {
  isPromptActive(sessionId: string): boolean {
    return activePrompts.has(sessionId)
  },

  async createSession(agentId: string, taskId?: string, projectId?: string): Promise<SessionRow> {
    const agent = agentStore.get(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)
    const projectContext = resolveSessionProjectContext(agentId, taskId, projectId)

    const session = sessionStore.create({ agentId, taskId, projectId: projectContext.projectId })

    log.info({ sessionId: session.id, agentId, taskId, projectId: projectContext.projectId }, 'Local Session created')
    return session
  },

  async sendPrompt(sessionId: string, content: string, images?: ImageAttachment[], clientMessageId?: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (activePrompts.has(sessionId))
      throw new Error(
        '\u5f53\u524d\u4f1a\u8bdd\u6b63\u5728\u751f\u6210\u4e2d\uff0c\u8bf7\u7b49\u5f85\u672c\u8f6e\u5b8c\u6210\u6216\u5148\u505c\u6b62\u751f\u6210',
      )
    events.emit('session:manual-prompt-started', { sessionId, agentId: session.agent_id })
    return sendPromptNow(session, content, images, clientMessageId)
  },

  async enqueuePrompt(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    const previous = queuedPrompts.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        while (activePrompts.has(sessionId)) await waitForIdleTurn()
        const session = sessionStore.get(sessionId)
        if (!session) throw new Error(`Session not found: ${sessionId}`)
        await sendPromptNow(session, content, images)
      })
    queuedPrompts.set(sessionId, next)
    next
      .finally(() => {
        if (queuedPrompts.get(sessionId) === next) queuedPrompts.delete(sessionId)
      })
      .catch(() => undefined)
    return next
  },

  async sendDecision(sessionId: string, _messageId: string, _choice: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error(`Session \u4e0d\u5b58\u5728: ${sessionId}`)
    // TODO: implement ACP decision forwarding
  },

  async closeSession(sessionId: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) return

    await acpHost.closeSession(session.agent_id, sessionId)
    sessionStore.updateStatus(sessionId, 'closed')
    const updated = sessionStore.get(sessionId)
    if (updated) events.emit('session:changed', { sessionId, data: { ...updated } })
    log.info({ sessionId, agentId: session.agent_id }, 'Session \u5df2\u5173\u95ed')
  },

  renameSession(sessionId: string, title: string): SessionRow {
    const session = sessionStore.updateTitle(sessionId, title)
    if (!session) throw new Error(`Session \u4e0d\u5b58\u5728: ${sessionId}`)
    events.emit('session:changed', { sessionId, data: { ...session } })
    log.info({ sessionId, title: session.title }, 'Session \u5df2\u91cd\u547d\u540d')
    return session
  },

  archiveSession(sessionId: string): SessionRow {
    const session = sessionStore.archive(sessionId)
    if (!session) throw new Error(`Session \u4e0d\u5b58\u5728: ${sessionId}`)
    events.emit('session:changed', { sessionId, data: { ...session, event: 'archived' } })
    log.info({ sessionId }, 'Session \u5df2\u5f52\u6863')
    return session
  },

  async deleteSession(sessionId: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) return
    await acpHost.closeSession(session.agent_id, sessionId)
    sessionStore.delete(sessionId)
    events.emit('session:changed', { sessionId, data: { event: 'deleted', deleted: true } })
    log.info({ sessionId, agentId: session.agent_id }, 'Session \u5df2\u5220\u9664')
  },
}

async function sendPromptNow(session: SessionRow, content: string, images?: ImageAttachment[], clientMessageId?: string): Promise<void> {
  const sessionId = session.id
  const promptLen = content.length
  const imageCount = images?.length ?? 0
  log.debug({ sessionId, agentId: session.agent_id, promptLen, imageCount }, 'send prompt')

  activePrompts.add(sessionId)
  let activityEndReason: SessionActivityReason = 'prompt-done'
  emitSessionActivity(sessionId, session.agent_id, 'running', 'prompt-started')
  try {
    const humanMessage = messageStore.append(sessionId, { id: clientMessageId, role: 'human', content, attachments: images })
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

    const projectContext = resolveSessionProjectContext(
      session.agent_id,
      session.task_id ?? undefined,
      session.project_id ?? undefined,
    )
    const acpSessionId = await acpHost.ensureSession(
      session.agent_id,
      sessionId,
      session.acp_session_id,
      projectContext,
    )
    if (session.acp_session_id !== acpSessionId) {
      sessionStore.updateAcpSessionId(sessionId, acpSessionId)
      log.info({ sessionId, acpSessionId }, 'ACP Session mapped')
    }
    const acpContent = maybeWrapTeamLeaderPrompt(sessionId, content)
    emitLifecycle(session.agent_id, sessionId, 'lifecycle.prompt_sent', '\u6b63\u5728\u601d\u8003...')
    await acpHost.prompt(session.agent_id, sessionId, acpContent, images)
  } catch (err) {
    activityEndReason = 'prompt-error'
    const message = err instanceof Error ? err.message : String(err)
    emitLifecycle(session.agent_id, sessionId, 'lifecycle.failed', `\u6267\u884c\u5931\u8d25\uff1a${message}`)
    log.error({ err, sessionId, agentId: session.agent_id }, 'prompt failed')
    events.emit('session:done', {
      sessionId,
      agentId: session.agent_id,
      messageId: `error-${sessionId}-${Date.now()}`,
      stopReason: 'error',
      error: message,
    })
    throw err
  } finally {
    activePrompts.delete(sessionId)
    emitSessionActivity(sessionId, session.agent_id, 'idle', activityEndReason)
  }
}

async function waitForIdleTurn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100))
}

function maybeWrapTeamLeaderPrompt(sessionId: string, content: string): string {
  const session = sessionStore.get(sessionId)
  if (!session) return content
  const member = teamMemberStore.getBySession(sessionId)
  if (member?.role === 'leader') return buildTeamLeaderPrompt(content)
  const visibleNames = resolveVisiblePlatformTools({
    agentId: session.agent_id,
    projectId: session.project_id ?? undefined,
    sessionId,
  }).map((tool) => tool.definition.name)
  return visibleNames.includes('team.member.message') ? buildTeamLeaderPrompt(content) : content
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

function emitSessionActivity(
  sessionId: string,
  agentId: string,
  state: SessionActivityState,
  reason: SessionActivityReason,
): void {
  events.emit('session:activity', {
    sessionId,
    agentId,
    state,
    reason,
    timestamp: new Date().toISOString(),
  })
}

function resolveSessionProjectContext(
  agentId: string,
  taskId?: string,
  existingProjectId?: string,
): { projectId?: string; cwd?: string } {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  const task = taskId ? taskStore.get(taskId) : undefined
  if (taskId && !task) throw new Error(`Task not found: ${taskId}`)

  const projectIds = [existingProjectId, agent.project_id ?? undefined, task?.project_id ?? undefined].filter(Boolean)
  const projectId = projectIds[0]
  if (projectId && projectIds.some((id) => id !== projectId)) {
    throw new Error(`Project mismatch between agent/task/session: ${projectIds.join(', ')}`)
  }
  if (!projectId) return {}

  const project = projectStore.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return { projectId, cwd: project.work_dir }
}
