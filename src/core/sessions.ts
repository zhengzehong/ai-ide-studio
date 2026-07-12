import { randomUUID } from 'node:crypto'
import { sessionStore, messageStore, eventStore, type SessionRow } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { agentStore } from '../store/agents.js'
import { globalAssistantStore } from '../store/global-assistant.js'
import { projectStore } from '../store/projects.js'
import { teamMemberStore } from '../store/teams.js'
import { acpHost } from '../acp/host.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { agentHubService } from './agent-hub/index.js'
import type { ImageAttachment, SessionActivityReason, SessionActivityState, SessionUpdateData } from '../types/ws-protocol.js'
import { createPendingTurn, finalizePendingTurn, updatePendingTurn, type PendingTurn } from './turn-finalizer.js'
import { buildTeamLeaderPrompt } from './team-prompts.js'
import { resolveVisiblePlatformTools } from '../tools/registry/visibility-resolver.js'
import { eventPayloadFromUpdate } from './session-event-payload.js'
import { SessionUpdateBatcher, type SessionUpdateEnvelope } from './session-update-batcher.js'
import {
  createTurnId,
  finishPromptDiagnostics,
  getPromptTurnId,
  recordPromptProgress,
  startPromptDiagnostics,
  summarizeSessionUpdate,
  summarizeSessionUpdateData,
} from './prompt-diagnostics.js'
import {
  completeTurnProcess,
  createAgentMessageId,
  recordTurnProcessUpdate,
  startTurnProcess,
} from './turn-process-runtime.js'
import { appendHiddenAttachmentNote, loadStoredImagesForAcp, saveSessionImages } from './image-attachments.js'
import { sessionShareManager } from './session-share-manager.js'

const log = createChildLogger('session')

const pendingBySession = new Map<string, PendingTurn>()
const activePrompts = new Set<string>()
const queuedPrompts = new Map<string, Promise<void>>()
const copyingSourceSessions = new Set<string>()
const eventBatcher = new SessionUpdateBatcher()

interface PromptOptions {
  clientMessageId?: string
  contextProjectId?: string
  senderRole?: string
  senderId?: string | null
  senderName?: string | null
}
const COPYING_STAGE = '正在复制会话...'

events.on('session:update', (ev) => {
  const turnId = getPromptTurnId(ev.sessionId)
  recordPromptProgress(ev.sessionId, summarizeSessionUpdate(ev.data))
  log.debug({ sessionId: ev.sessionId, agentId: ev.agentId, turnId, ...summarizeSessionUpdateData(ev.data) }, 'session update received')
  const { sessionId, data } = ev
  let pending = pendingBySession.get(sessionId)
  if (!pending) {
    pending = createPendingTurn()
    pendingBySession.set(sessionId, pending)
  }

  pendingBySession.set(sessionId, updatePendingTurn(pending, data))
})

events.on('session:update', (ev) => {
  recordTurnProcessUpdate(ev.sessionId, ev.agentId, ev.data)
})

events.on('session:update', (ev) => {
  eventBatcher.handle(ev, persistSessionUpdateEvent)
})

function persistSessionUpdateEvent(ev: SessionUpdateEnvelope): void {
  const turnId = getPromptTurnId(ev.sessionId)
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
  log.debug(
    { sessionId: ev.sessionId, agentId: ev.agentId, turnId, eventId: stored.id, sequence: stored.sequence, eventType: stored.type, messageId: stored.message_id },
    'session event persisted',
  )
  events.emit('session:event', { sessionId: ev.sessionId, agentId: ev.agentId, event: stored })
}

function eventTurnId(ev: { sessionId: string; turnId?: string }): string | undefined {
  return ev.turnId ?? getPromptTurnId(ev.sessionId)
}

events.on('session:done', (ev) => {
  eventBatcher.flushSession(ev.sessionId, persistSessionUpdateEvent)
  const turnId = eventTurnId(ev)
  recordPromptProgress(ev.sessionId, 'session.done')
  log.info({ sessionId: ev.sessionId, agentId: ev.agentId, turnId, messageId: ev.messageId, stopReason: ev.stopReason, hasError: !!ev.error, turnUsage: ev.turnUsage }, 'session done received')
  const stored = eventStore.append(ev.sessionId, {
    type: 'message.done',
    agentId: ev.agentId,
    messageId: ev.messageId,
    role: 'agent',
    payload: { messageId: ev.messageId, turnId, turnUsage: ev.turnUsage, stopReason: ev.stopReason, error: ev.error },
  })
  log.info(
    { sessionId: ev.sessionId, agentId: ev.agentId, turnId, eventId: stored.id, sequence: stored.sequence, messageId: stored.message_id, stopReason: ev.stopReason },
    'session done event persisted',
  )
  events.emit('session:event', { sessionId: ev.sessionId, agentId: ev.agentId, event: stored })
})

events.on('session:done', (ev) => {
  const updated = sessionStore.clearStageIfRunning(ev.sessionId)
  if (updated) events.emit('session:changed', { sessionId: ev.sessionId, data: { ...updated } })
})

events.on('session:done', (ev) => {
  const turnId = eventTurnId(ev)
  const pending = pendingBySession.get(ev.sessionId)
  const finalized = pending ? finalizePendingTurn(pending) : null
  const processStatus = ev.stopReason === 'error'
    ? 'failed'
    : ev.stopReason === 'cancelled'
      ? 'cancelled'
      : 'completed'
  const processResult = completeTurnProcess(ev.sessionId, processStatus)
  const finalMessageId = processResult.messageId ?? finalized?.messageId ?? ev.messageId

  if (finalized) {
    const finalContent = processResult.finalAnswer !== undefined ? processResult.finalAnswer : finalized.content
    const message = messageStore.completeAgentMessage(finalMessageId, {
      content: finalContent,
      thinking: finalized.thinking || undefined,
      toolCalls: finalized.toolCalls,
      status: processStatus,
      stats: ev.turnUsage,
      fileChangesJson: processResult.fileChangesJson,
    }) ?? messageStore.append(ev.sessionId, {
      id: finalMessageId,
      role: 'agent',
      content: finalContent,
      thinking: finalized.thinking || undefined,
      toolCalls: finalized.toolCalls,
      status: processStatus,
      stats: ev.turnUsage,
      fileChangesJson: processResult.fileChangesJson,
    })
    sessionStore.touch(ev.sessionId, message.timestamp)
    log.info(
      {
        sessionId: ev.sessionId,
        agentId: ev.agentId,
        turnId,
        messageId: message.id,
        contentLength: message.content.length,
        thinkingLength: message.thinking?.length ?? 0,
        toolCallCount: finalized.toolCalls?.length ?? 0,
        stopReason: ev.stopReason,
      },
      'agent message finalized',
    )
    recordPromptProgress(ev.sessionId, 'message.finalized')
  } else if (processResult.messageId && !(ev.stopReason === 'error' && ev.error)) {
    const message = messageStore.completeAgentMessage(finalMessageId, {
      content: processResult.finalAnswer ?? '',
      status: processStatus,
      stats: ev.turnUsage,
      fileChangesJson: processResult.fileChangesJson,
    }) ?? messageStore.append(ev.sessionId, {
      id: finalMessageId,
      role: 'agent',
      content: processResult.finalAnswer ?? '',
      status: processStatus,
      stats: ev.turnUsage,
      fileChangesJson: processResult.fileChangesJson,
    })
    sessionStore.touch(ev.sessionId, message.timestamp)
    log.info(
      {
        sessionId: ev.sessionId,
        agentId: ev.agentId,
        turnId,
        messageId: message.id,
        contentLength: message.content.length,
        stopReason: ev.stopReason,
      },
      'agent message completed from running snapshot',
    )
    recordPromptProgress(ev.sessionId, 'message.completed_snapshot')
  } else if (ev.stopReason === 'error' && ev.error) {
    const content = `执行失败：${ev.error}`
    const message = messageStore.completeAgentMessage(finalMessageId, {
      content,
      status: 'failed',
      stats: ev.turnUsage,
      fileChangesJson: processResult.fileChangesJson,
    }) ?? messageStore.append(ev.sessionId, {
      id: finalMessageId,
      role: 'agent',
      content,
      status: 'failed',
      stats: ev.turnUsage,
      fileChangesJson: processResult.fileChangesJson,
    })
    sessionStore.touch(ev.sessionId, message.timestamp)
    log.info(
      { sessionId: ev.sessionId, agentId: ev.agentId, turnId, messageId: message.id, contentLength: message.content.length, stopReason: ev.stopReason },
      'agent error message finalized',
    )
    recordPromptProgress(ev.sessionId, 'message.error.finalized')
  } else {
    log.debug({ sessionId: ev.sessionId, agentId: ev.agentId, turnId, messageId: ev.messageId, stopReason: ev.stopReason }, 'session done without finalizable message')
    recordPromptProgress(ev.sessionId, 'message.finalize.skipped')
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

  async copySession(sourceSessionId: string): Promise<SessionRow> {
    const source = sessionStore.get(sourceSessionId)
    if (!source) throw new Error(`Session not found: ${sourceSessionId}`)
    if (activePrompts.has(sourceSessionId)) {
      throw new Error('当前会话正在生成中，完成后再复制')
    }

    if (copyingSourceSessions.has(sourceSessionId)) {
      throw new Error('当前会话正在复制中，请稍后')
    }
    if (!source.acp_session_id) {
      throw new Error('当前会话暂无可复制的运行时上下文')
    }

    const projectContext = resolveSessionProjectContext(
      source.agent_id,
      undefined,
      source.project_id ?? undefined,
    )
    const copied = sessionStore.create({ agentId: source.agent_id, projectId: projectContext.projectId })
    sessionStore.updateTitle(copied.id, `Fork from ${source.title || source.id}`)
    sessionStore.updateStage(copied.id, COPYING_STAGE)
    copyingSourceSessions.add(sourceSessionId)

    const placeholder = sessionStore.get(copied.id)
    if (!placeholder) throw new Error(`Copied session missing: ${copied.id}`)
    events.emit('session:changed', { sessionId: copied.id, data: { ...placeholder } })

    void completeCopiedSessionFork(source, copied.id, source.acp_session_id, projectContext)
    return placeholder
  },

  async sendPrompt(sessionId: string, content: string, images?: ImageAttachment[], options?: string | PromptOptions): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (session.status !== 'active') throw new Error('当前会话已关闭，不能继续发送消息')
    if (activePrompts.has(sessionId))
      throw new Error(
        '\u5f53\u524d\u4f1a\u8bdd\u6b63\u5728\u751f\u6210\u4e2d\uff0c\u8bf7\u7b49\u5f85\u672c\u8f6e\u5b8c\u6210\u6216\u5148\u505c\u6b62\u751f\u6210',
      )
    events.emit('session:manual-prompt-started', { sessionId, agentId: session.agent_id })
    return sendPromptNow(session, content, images, normalizePromptOptions(options))
  },

  async enqueuePrompt(sessionId: string, content: string, images?: ImageAttachment[], options?: string | PromptOptions): Promise<void> {
    const normalizedOptions = normalizePromptOptions(options)
    const previous = queuedPrompts.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        while (activePrompts.has(sessionId)) await waitForIdleTurn()
        const session = sessionStore.get(sessionId)
        if (!session) throw new Error(`Session not found: ${sessionId}`)
        if (session.status !== 'active') throw new Error('当前会话已关闭，不能继续发送消息')
        await sendPromptNow(session, content, images, normalizedOptions)
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

    await agentHubService.disconnectBySession(sessionId)
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
    void agentHubService.disconnectBySession(sessionId)
    events.emit('session:changed', { sessionId, data: { ...session, event: 'archived' } })
    log.info({ sessionId }, 'Session \u5df2\u5f52\u6863')
    return session
  },

  async deleteSession(sessionId: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) return
    await agentHubService.disconnectBySession(sessionId)
    await acpHost.closeSession(session.agent_id, sessionId)
    sessionStore.delete(sessionId)
    sessionShareManager.cascadeSoftDeleteBySession(sessionId)
    events.emit('session:changed', { sessionId, data: { event: 'deleted', deleted: true } })
    log.info({ sessionId, agentId: session.agent_id }, 'Session \u5df2\u5220\u9664')
  },
}

function normalizePromptOptions(options?: string | PromptOptions): PromptOptions {
  return typeof options === 'string' ? { clientMessageId: options } : options ?? {}
}

function resolvePromptProjectId(session: SessionRow, options: PromptOptions): string | undefined {
  const sessionProjectId = session.project_id ?? undefined
  if (!options.contextProjectId || options.contextProjectId === sessionProjectId) return sessionProjectId
  if (!sessionProjectId) return options.contextProjectId
  throw new Error(`Project mismatch between session and prompt context: ${sessionProjectId}, ${options.contextProjectId}`)
}

async function sendPromptNow(session: SessionRow, content: string, images?: ImageAttachment[], options: PromptOptions = {}): Promise<void> {
  const sessionId = session.id
  const turnId = createTurnId()
  const startedAt = Date.now()
  const promptLen = content.length
  const imageCount = images?.length ?? 0
  const effectiveProjectId = resolvePromptProjectId(session, options)
  log.info(
    {
      sessionId,
      agentId: session.agent_id,
      projectId: effectiveProjectId,
      taskId: session.task_id,
      turnId,
      promptLen,
      imageCount,
      clientMessageId: options.clientMessageId,
    },
    'prompt received',
  )

  activePrompts.add(sessionId)
  startPromptDiagnostics({
    turnId,
    sessionId,
    agentId: session.agent_id,
    projectId: effectiveProjectId,
    startedAt,
    lastProgressAt: startedAt,
    lastProgress: 'prompt.received',
  })
  let activityEndReason: SessionActivityReason = 'prompt-done'
  log.debug({ sessionId, agentId: session.agent_id, turnId, activePromptCount: activePrompts.size }, 'prompt marked active')
  emitSessionActivity(sessionId, session.agent_id, 'running', 'prompt-started', turnId)
  const agentMessageId = createAgentMessageId()
  try {
    const generatedHumanMessageId = imageCount > 0 ? `msg-${randomUUID().slice(0, 8)}` : undefined
    const humanMessageId = options.clientMessageId ?? generatedHumanMessageId
    const storedImages = await saveSessionImages({
      projectId: effectiveProjectId,
      sessionId,
      messageId: humanMessageId ?? `msg-${randomUUID().slice(0, 8)}`,
      images,
    })
    const messageAttachments = storedImages.length > 0 ? storedImages : images
    const humanMessage = messageStore.append(sessionId, {
      id: humanMessageId,
      role: 'human',
      content,
      attachments: messageAttachments,
      senderId: options.senderId ?? null,
      senderName: options.senderName ?? null,
      senderRole: options.senderRole ?? 'user',
    })
    recordPromptProgress(sessionId, 'human.message.persisted')
    log.info(
      { sessionId, agentId: session.agent_id, turnId, messageId: humanMessage.id, contentLength: humanMessage.content.length, imageCount, timestamp: humanMessage.timestamp, senderRole: humanMessage.sender_role },
      'human message persisted',
    )
    sessionStore.touch(sessionId, humanMessage.timestamp)
    const stored = eventStore.append(sessionId, {
      type: 'message.user',
      agentId: session.agent_id,
      messageId: humanMessage.id,
      role: 'human',
      payload: {
        messageId: humanMessage.id,
        content,
        attachments: messageAttachments || [],
        senderRole: humanMessage.sender_role,
        senderId: humanMessage.sender_id,
        senderName: humanMessage.sender_name,
      },
    })
    log.info(
      { sessionId, agentId: session.agent_id, turnId, eventId: stored.id, sequence: stored.sequence, messageId: stored.message_id },
      'human message event persisted',
    )
    events.emit('session:event', { sessionId, agentId: session.agent_id, event: stored })
    const agentMessage = messageStore.append(sessionId, {
      id: agentMessageId,
      role: 'agent',
      content: '',
      status: 'running',
      startedAt: new Date(startedAt).toISOString(),
    })
    startTurnProcess(sessionId, agentMessage.id)
    sessionStore.touch(sessionId, agentMessage.timestamp)
    emitLifecycle(session.agent_id, sessionId, 'lifecycle.prompt_received', '正在准备 Agent...', agentMessage.id)
    const projectContext = resolveSessionProjectContext(
      session.agent_id,
      session.task_id ?? undefined,
      effectiveProjectId,
      session.id,
    )
    recordPromptProgress(sessionId, 'acp.session.ensure.started')
    log.info({ sessionId, agentId: session.agent_id, turnId, acpSessionId: session.acp_session_id, projectId: projectContext.projectId, cwd: projectContext.cwd }, 'ACP ensure session start')
    const acpSessionId = await acpHost.ensureSession(
      session.agent_id,
      sessionId,
      session.acp_session_id,
      projectContext,
    )
    recordPromptProgress(sessionId, 'acp.session.ready')
    log.info({ sessionId, agentId: session.agent_id, turnId, acpSessionId }, 'ACP ensure session done')
    if (session.acp_session_id !== acpSessionId) {
      sessionStore.updateAcpSessionId(sessionId, acpSessionId)
      log.info({ sessionId, agentId: session.agent_id, turnId, acpSessionId }, 'ACP Session mapped')
    }
    const acpContent = appendHiddenAttachmentNote(
      maybeWrapTeamLeaderPrompt(sessionId, content, effectiveProjectId),
      storedImages,
    )
    const acpImages = storedImages.length > 0 ? await loadStoredImagesForAcp(storedImages) : images
    emitLifecycle(session.agent_id, sessionId, 'lifecycle.prompt_sent', '正在思考...', agentMessageId)
    recordPromptProgress(sessionId, 'acp.prompt.started')
    try {
      await acpHost.prompt(session.agent_id, sessionId, acpContent, acpImages, { turnId, messageId: agentMessageId })
    } catch (err) {
      const isForceCancel = err instanceof Error && err.message.startsWith('cancel timeout: forcing done')
      if (isForceCancel) {
        log.warn({ sessionId, agentId: session.agent_id, turnId, elapsedMs: Date.now() - startedAt }, 'acp prompt force-cancelled, swallowing to avoid blocking next turn')
      } else {
        throw err
      }
    }
    recordPromptProgress(sessionId, 'acp.prompt.resolved')
    log.info({ sessionId, agentId: session.agent_id, turnId, elapsedMs: Date.now() - startedAt }, 'prompt completed')
  } catch (err) {
    activityEndReason = 'prompt-error'
    const message = err instanceof Error ? err.message : String(err)
    emitLifecycle(session.agent_id, sessionId, 'lifecycle.failed', `执行失败：${message}`, agentMessageId)
    log.error({ err, sessionId, agentId: session.agent_id, turnId, elapsedMs: Date.now() - startedAt }, 'prompt failed')
    events.emit('session:done', {
      sessionId,
      agentId: session.agent_id,
      messageId: agentMessageId,
      turnId,
      stopReason: 'error',
      error: message,
    })
    throw err
  } finally {
    activePrompts.delete(sessionId)
    finishPromptDiagnostics(sessionId, activityEndReason)
    log.info({ sessionId, agentId: session.agent_id, turnId, reason: activityEndReason, elapsedMs: Date.now() - startedAt, activePromptCount: activePrompts.size }, 'prompt cleanup complete')
    emitSessionActivity(sessionId, session.agent_id, 'idle', activityEndReason, turnId)
  }
}


async function waitForIdleTurn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100))
}

function maybeWrapTeamLeaderPrompt(sessionId: string, content: string, contextProjectId?: string): string {
  const session = sessionStore.get(sessionId)
  if (!session) return content
  const member = teamMemberStore.getBySession(sessionId)
  if (member?.role === 'leader') return buildTeamLeaderPrompt(content)
  const visibleNames = resolveVisiblePlatformTools({
    agentId: session.agent_id,
    projectId: contextProjectId ?? session.project_id ?? undefined,
    sessionId,
  }).map((tool) => tool.definition.name)
  return visibleNames.includes('team.member.message') ? buildTeamLeaderPrompt(content) : content
}

function emitLifecycle(agentId: string, sessionId: string, eventType: string, content: string, messageId?: string): void {
  sessionStore.updateStage(sessionId, content)
  const updated = sessionStore.get(sessionId)
  if (updated) events.emit('session:changed', { sessionId, data: { ...updated } })
  events.emit('session:update', {
    sessionId,
    agentId,
    data: { messageId: messageId ?? `${eventType}-${Date.now()}`, role: 'system', content, eventType } satisfies SessionUpdateData,
  })
}

function emitSessionActivity(
  sessionId: string,
  agentId: string,
  state: SessionActivityState,
  reason: SessionActivityReason,
  turnId?: string,
): void {
  events.emit('session:activity', {
    sessionId,
    agentId,
    turnId,
    state,
    reason,
    timestamp: new Date().toISOString(),
  })
}

function resolveSessionProjectContext(
  agentId: string,
  taskId?: string,
  existingProjectId?: string,
  sessionId?: string,
): { projectId?: string; cwd?: string } {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  const task = taskId ? taskStore.get(taskId) : undefined
  if (taskId && !task) throw new Error(`Task not found: ${taskId}`)

  const globalWorkspaceDir = sessionId ? globalAssistantStore.workspaceForSession(sessionId) : undefined
  if (globalWorkspaceDir) return { projectId: existingProjectId, cwd: globalWorkspaceDir }

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

async function completeCopiedSessionFork(
  source: SessionRow,
  copiedSessionId: string,
  sourceAcpSessionId: string,
  projectContext: { projectId?: string; cwd?: string },
): Promise<void> {
  try {
    const acpSessionId = await acpHost.forkSessionFromAcpSessionId(
      source.agent_id,
      sourceAcpSessionId,
      copiedSessionId,
      projectContext,
    )
    sessionStore.updateAcpSessionId(copiedSessionId, acpSessionId)
    sessionStore.updateStage(copiedSessionId, '')
    const updated = sessionStore.get(copiedSessionId)
    if (!updated) throw new Error(`Copied session missing: ${copiedSessionId}`)
    events.emit('session:changed', { sessionId: copiedSessionId, data: { ...updated } })
    log.info(
      {
        sourceSessionId: source.id,
        copiedSessionId,
        agentId: source.agent_id,
        acpSessionId,
      },
      'Session copied',
    )
  } catch (err) {
    await acpHost.closeSession(source.agent_id, copiedSessionId)
    sessionStore.delete(copiedSessionId)
    copyingSourceSessions.delete(source.id)
    const message = err instanceof Error ? err.message : String(err)
    events.emit('session:copy_failed', { sourceSessionId: source.id, targetSessionId: copiedSessionId, message })
    log.error({ err, sourceSessionId: source.id, copiedSessionId, agentId: source.agent_id }, 'Session copy failed')
    return
  }

  copyingSourceSessions.delete(source.id)
}
