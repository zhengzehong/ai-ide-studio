import { randomUUID } from 'node:crypto'
import { beginDeviceOrigin, endDeviceOrigin } from '../devices/prompt-origin.js'
import { sessionStore, messageStore, eventStore, type SessionRow } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { agentStore } from '../store/agents.js'
import { globalAssistantStore } from '../store/global-assistant.js'
import { projectStore } from '../store/projects.js'
import { teamMemberStore } from '../store/teams.js'
import { getRuntimePort } from '../runtime/runtime-port-provider.js'
import { observeSyncDbOperation } from '../store/db-operation-observer.js'
import { buildRuntimeStateSnapshot } from '../runtime/api/runtime-snapshot.js'
import { forkSessionInto } from './session-fork.js'
import { events, type AppEvents } from './events.js'
import { createChildLogger } from './logger.js'
import { publishSessionCreated } from './session-change-events.js'
import { agentHubService } from './agent-hub/index.js'
import { assertSessionManageable } from './session-manage-guard.js'
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
import type { StoredImageAttachment } from './image-attachments.js'
import { sessionShareManager } from './session-share-manager.js'
import { sessionPersistencePort } from './persistence/session-persistence-port.js'
import { SessionPromptBatcher } from './session-prompt-batcher.js'
import type { PromptIntent } from './prompt-intent.js'
import { validatePromptIntent } from './task-step-intent-validator.js'
import { presentationsJsonFromToolCalls } from './message-presentations.js'

const log = createChildLogger('session')

const pendingBySession = new Map<string, PendingTurn>()
const activePrompts = new Set<string>()
const promptBatcher = new SessionPromptBatcher<QueuedPrompt>(filterPromptIntents)
const copyingSourceSessions = new Set<string>()
const eventBatcher = new SessionUpdateBatcher()
const persistenceBySession = new Map<string, Promise<void>>()
const persistenceErrors = new Map<string, unknown>()

interface PromptOptions {
  originDeviceId?: string
  clientMessageId?: string
  contextProjectId?: string
  senderRole?: string
  senderId?: string | null
  senderName?: string | null
  dedupeKey?: string
  batchKey?: string
  modelContent?: string
  intent?: PromptIntent
}

interface QueuedPrompt {
  content: string
  images?: ImageAttachment[]
  options: PromptOptions
  projectId?: string
  source: 'user' | 'platform'
  intent?: PromptIntent
}
export const COPYING_STAGE = '正在复制会话...'

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

  pendingBySession.set(sessionId, updatePendingTurn(pending, data, { source: ev.source }))
})

events.on('session:update', (ev) => {
  recordTurnProcessUpdate(ev.sessionId, ev.agentId, ev.data, { source: ev.source })
})

events.on('session:update', (ev) => {
  eventBatcher.handle(ev, persistSessionUpdateEvent)
})

async function persistSessionUpdateEvent(ev: SessionUpdateEnvelope): Promise<void> {
  const turnId = getPromptTurnId(ev.sessionId)
  const payload = eventPayloadFromUpdate(ev.data)
  if (!payload) return
  if (ev.data.sessionInfo?.title) {
    await sessionPersistencePort.commitMutations(ev.sessionId, 'background', [{
      type: 'session.title.update-if-empty',
      sessionId: ev.sessionId,
      title: ev.data.sessionInfo.title,
      timestamp: new Date().toISOString(),
    }])
    const updated = sessionStore.get(ev.sessionId)
    if (updated) events.emit('session:changed', { sessionId: ev.sessionId, data: { ...updated } })
  }
  const stored = await sessionPersistencePort.appendEvent(ev.sessionId, {
    type: payload.type,
    agentId: ev.agentId,
    messageId: ev.data.messageId,
    role: ev.data.role,
    payload: payload.payload,
  }, 'background')
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
  persistenceErrors.delete(ev.sessionId)
  const pending = persistSessionDone(ev)
  persistenceBySession.set(ev.sessionId, pending)
  void pending.catch((err: unknown) => {
    persistenceErrors.set(ev.sessionId, err)
    log.error(
      { err, sessionId: ev.sessionId, agentId: ev.agentId, turnId: eventTurnId(ev) },
      'session done persistence failed',
    )
  }).finally(() => {
    if (persistenceBySession.get(ev.sessionId) === pending) persistenceBySession.delete(ev.sessionId)
  })
})

async function persistSessionDone(ev: AppEvents['session:done']): Promise<void> {
  const turnId = eventTurnId(ev)
  try {
    await eventBatcher.flushSession(ev.sessionId, persistSessionUpdateEvent)
  } catch (err) {
    log.warn(
      { err, sessionId: ev.sessionId, agentId: ev.agentId, turnId },
      'background session persistence failed before terminal; continuing terminal commit',
    )
  }
  await finalizeSessionMessage(ev)
  recordPromptProgress(ev.sessionId, 'session.done')
  log.info({ sessionId: ev.sessionId, agentId: ev.agentId, turnId, messageId: ev.messageId, stopReason: ev.stopReason, hasError: !!ev.error, turnUsage: ev.turnUsage }, 'session done received')
  const stored = await sessionPersistencePort.appendEvent(ev.sessionId, {
    type: 'message.done',
    agentId: ev.agentId,
    messageId: ev.messageId,
    role: 'agent',
    payload: { messageId: ev.messageId, turnId, turnUsage: ev.turnUsage, stopReason: ev.stopReason, error: ev.error },
  }, 'critical')
  log.info(
    { sessionId: ev.sessionId, agentId: ev.agentId, turnId, eventId: stored.id, sequence: stored.sequence, messageId: stored.message_id, stopReason: ev.stopReason },
    'session done event persisted',
  )
  events.emit('session:event', { sessionId: ev.sessionId, agentId: ev.agentId, event: stored })
  events.emit('session:committed_done', ev)
  sessionPersistencePort.finishSession(ev.sessionId)
}

async function finalizeSessionMessage(ev: AppEvents['session:done']): Promise<void> {
  const turnId = eventTurnId(ev)
  const pending = pendingBySession.get(ev.sessionId)
  const finalized = pending ? finalizePendingTurn(pending) : null
  const processStatus = ev.stopReason === 'error'
    ? 'failed'
    : ev.stopReason === 'cancelled'
      ? 'cancelled'
      : 'completed'
  const processResult = await completeTurnProcess(ev.sessionId, processStatus)
  const finalMessageId = processResult.messageId ?? finalized?.messageId ?? ev.messageId

  if (finalized) {
    const finalContent = processResult.finalAnswer || finalized.content
    await commitFinalMessage(ev, {
      messageId: finalMessageId,
      content: finalContent,
      processStatus,
      toolCalls: finalized.toolCalls,
      thinkingLength: finalized.thinking?.length ?? 0,
      progress: 'message.finalized',
      logMessage: 'agent message finalized',
    })
  } else if (processResult.messageId && !(ev.stopReason === 'error' && ev.error)) {
    await commitFinalMessage(ev, {
      messageId: finalMessageId,
      content: processResult.finalAnswer ?? '',
      processStatus,
      progress: 'message.completed_snapshot',
      logMessage: 'agent message completed from running snapshot',
    })
  } else if (ev.stopReason === 'error' && ev.error) {
    const content = `执行失败：${ev.error}`
    await commitFinalMessage(ev, {
      messageId: finalMessageId,
      content,
      processStatus: 'failed',
      progress: 'message.error.finalized',
      logMessage: 'agent error message finalized',
    })
  } else {
    await sessionPersistencePort.commitMutations(ev.sessionId, 'critical', [{
      type: 'session.stage.clear-running',
      sessionId: ev.sessionId,
      timestamp: new Date().toISOString(),
    }])
    log.debug({ sessionId: ev.sessionId, agentId: ev.agentId, turnId, messageId: ev.messageId, stopReason: ev.stopReason }, 'session done without finalizable message')
    recordPromptProgress(ev.sessionId, 'message.finalize.skipped')
  }
  const updated = sessionStore.get(ev.sessionId)
  if (updated) events.emit('session:changed', { sessionId: ev.sessionId, data: { ...updated } })
  pendingBySession.delete(ev.sessionId)
}

interface FinalMessageCommitInput {
  messageId: string
  content: string
  processStatus: string
  toolCalls?: unknown[]
  thinkingLength?: number
  progress: string
  logMessage: string
}

async function commitFinalMessage(ev: AppEvents['session:done'], input: FinalMessageCommitInput): Promise<void> {
  const statsJson = ev.turnUsage ? JSON.stringify(ev.turnUsage) : null
  const result = await sessionPersistencePort.finalizeTurn({
    sessionId: ev.sessionId,
    messageId: input.messageId,
    processStatus: input.processStatus,
    content: input.content,
    status: input.processStatus,
    timestamp: new Date().toISOString(),
    decisionJson: statsJson,
    statsJson,
    presentationsJson: presentationsJsonFromToolCalls(input.toolCalls),
  })
  const message = messageStore.get(result.messageId)
  log.info({
    sessionId: ev.sessionId,
    agentId: ev.agentId,
    turnId: eventTurnId(ev),
    messageId: result.messageId,
    contentLength: input.content.length,
    thinkingLength: input.thinkingLength ?? 0,
    toolCallCount: input.toolCalls?.length ?? 0,
    processItemCount: result.processItemCount,
    stopReason: ev.stopReason,
    persisted: !!message,
  }, input.logMessage)
  recordPromptProgress(ev.sessionId, input.progress)
}

// BR-03: 系统不因 session:done 自动改变任务状态，由 Agent 通过 studio.task.* 工具主动管理

export const sessionManager = {
  isPromptActive(sessionId: string): boolean {
    return activePrompts.has(sessionId)
  },

  isPromptPending(sessionId: string): boolean {
    return activePrompts.has(sessionId) || promptBatcher.hasPending(sessionId)
  },

  listActivePromptSessionIds(): string[] {
    return [...activePrompts]
  },

  async waitForPersistence(sessionId: string): Promise<void> {
    const pending = persistenceBySession.get(sessionId)
    if (pending) await pending
    if (persistenceErrors.has(sessionId)) {
      const error = persistenceErrors.get(sessionId)
      persistenceErrors.delete(sessionId)
      throw error
    }
  },

  async createSession(
    agentId: string,
    taskId?: string,
    projectId?: string,
    purpose: SessionRow['purpose'] = 'conversation',
  ): Promise<SessionRow> {
    const agent = agentStore.get(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)
    const projectContext = resolveSessionProjectContext(agentId, taskId, projectId)

    const session = publishSessionCreated(
      sessionStore.create({ agentId, taskId, projectId: projectContext.projectId, purpose }),
    )

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
    publishSessionCreated(placeholder)

    void completeCopiedSessionFork(source, copied.id, projectContext)
    return placeholder
  },

  async sendPrompt(sessionId: string, content: string, images?: ImageAttachment[], options?: string | PromptOptions): Promise<void> {
    const session = requirePromptSession(sessionId)
    events.emit('session:manual-prompt-started', { sessionId, agentId: session.agent_id })
    return enqueueSessionPrompt(session, content, images, normalizePromptOptions(options), 'user')
  },

  async enqueuePrompt(sessionId: string, content: string, images?: ImageAttachment[], options?: string | PromptOptions): Promise<void> {
    const session = requirePromptSession(sessionId)
    return enqueueSessionPrompt(session, content, images, normalizePromptOptions(options))
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
    await getRuntimePort().closeSession(session.agent_id, sessionId)
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
    requireManageableSession(sessionId, 'archive')
    const archived = sessionStore.archive(sessionId)
    if (!archived) throw new Error(`Session \u4e0d\u5b58\u5728: ${sessionId}`)
    void agentHubService.disconnectBySession(sessionId)
    events.emit('session:changed', { sessionId, data: { ...archived, event: 'archived' } })
    log.info({ sessionId }, 'Session \u5df2\u5f52\u6863')
    return archived
  },

  restoreSession(sessionId: string): SessionRow {
    requireManageableSession(sessionId, 'restore')
    const restored = sessionStore.restore(sessionId)
    if (!restored) throw new Error(`Session \u4e0d\u5b58\u5728: ${sessionId}`)
    events.emit('session:changed', { sessionId, data: { ...restored, event: 'restored' } })
    log.info({ sessionId }, 'Session \u5df2\u8fd8\u539f')
    return restored
  },

  setSessionTags(sessionId: string, tags: string[]): SessionRow {
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error(`Session \u4e0d\u5b58\u5728: ${sessionId}`)
    if (session.deleted_at) throw new Error('\u4f1a\u8bdd\u5df2\u5220\u9664,\u4e0d\u80fd\u8bbe\u7f6e\u6807\u7b7e')
    const normalized = normalizeSessionTags(tags)
    const updated = sessionStore.setTags(sessionId, normalized)
    if (!updated) throw new Error(`Session \u4e0d\u5b58\u5728: ${sessionId}`)
    events.emit('session:changed', { sessionId, data: { ...updated } })
    log.info({ sessionId, tags: normalized }, 'Session \u6807\u7b7e\u5df2\u66f4\u65b0')
    return updated
  },

  async deleteSession(sessionId: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) return
    // \u5148\u5220\u672c\u5730 + \u7ea7\u8054\u6e05\u5206\u4eab\u94fe\u8def:\u8fd9\u4e24\u6b65\u662f\u5e73\u53f0\u81ea\u5df1\u7684\u72b6\u6001,\u4e0d\u4f9d\u8d56 ACP/Hub \u8fdc\u7a0b\u8c03\u7528,
    // \u5fc5\u987b\u5148\u6267\u884c\u6389,\u5426\u5219\u4e0b\u9762 Runtime closeSession \u629b\u9519\u4f1a\u5bfc\u81f4\u4f1a\u8bdd\u6c38\u4e0d\u5220\u9664 + \u5206\u4eab\u6b8b\u7559\u3002
    sessionStore.delete(sessionId)
    sessionShareManager.cascadeSoftDeleteBySession(sessionId)
    events.emit('session:changed', { sessionId, data: { event: 'deleted', deleted: true } })
    // Hub \u65ad\u5f00 + ACP closeSession \u90fd\u662f"\u5c3d\u529b\u6e05\u7406\u8fdc\u7a0b\u8d44\u6e90",\u5931\u8d25\u53ea warn \u4e0d\u963b\u585e delete RPC\u3002
    // \u5426\u5219\u8fdc\u7a0b\u6296\u52a8\u4f1a\u8ba9\u7528\u6237\u70b9\u5220\u9664\u540e RPC \u62a5\u9519\u3001\u4f1a\u8bdd\u5374\u5df2\u7ecf\u88ab\u672c\u5730\u5220\u6389,\u524d\u7aef\u5217\u8868\u9519\u4e71\u3002
    void agentHubService.disconnectBySession(sessionId).catch((err) => {
      log.warn({ sessionId, err: err instanceof Error ? err.message : String(err) }, 'Hub disconnect \u5931\u8d25,\u5ffd\u7565')
    })
    await getRuntimePort().closeSession(session.agent_id, sessionId).catch((err) => {
      log.warn({ sessionId, agentId: session.agent_id, err: err instanceof Error ? err.message : String(err) }, 'ACP closeSession \u5931\u8d25,\u5ffd\u7565')
    })
    log.info({ sessionId, agentId: session.agent_id }, 'Session \u5df2\u5220\u9664')
  },
}

function normalizePromptOptions(options?: string | PromptOptions): PromptOptions {
  return typeof options === 'string' ? { clientMessageId: options } : options ?? {}
}

// 会话标签约束：标签数量与单个长度的唯一权威，UI 与 AI 会话管理工具共用。
export const MAX_SESSION_TAGS = 10
export const MAX_SESSION_TAG_LENGTH = 24

export function normalizeSessionTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) throw new Error('tags 必须是字符串数组')
  const normalized: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') throw new Error('tags 必须是字符串数组')
    const tag = raw.trim()
    if (!tag) continue
    if (tag.length > MAX_SESSION_TAG_LENGTH) {
      throw new Error(`单个标签不能超过 ${MAX_SESSION_TAG_LENGTH} 个字符`)
    }
    if (normalized.includes(tag)) continue
    if (normalized.length >= MAX_SESSION_TAGS) {
      throw new Error(`每个会话最多 ${MAX_SESSION_TAGS} 个标签`)
    }
    normalized.push(tag)
  }
  return normalized
}

function requireManageableSession(
  sessionId: string,
  action: 'archive' | 'restore',
): void {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`Session 不存在: ${sessionId}`)
  const activityState = sessionStore.getSessionRuntimeState(sessionId, sessionManager.isPromptActive)
  assertSessionManageable({ ...session, activity_state: activityState }, action)
}

function requirePromptSession(sessionId: string): SessionRow {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  if (session.is_template) throw new Error('模板会话不能直接发送消息,请先从模板新建会话')
  if (session.status !== 'active') throw new Error('当前会话已关闭，不能继续发送消息')
  if (session.archived_at) throw new Error('会话已归档,不能发送消息')
  // 复制窗口守卫：COPYING_STAGE 的会话运行时映射尚未落定（后台 fork 完成时才回写 acp_session_id）。
  // 此时放行 prompt 会先经 ensureSession 写入新映射、随后被 fork 覆写，用户首轮消息所在的运行时会话成孤儿。
  if (session.stage === COPYING_STAGE) throw new Error('会话正在复制，请稍候再发送')
  return session
}

function enqueueSessionPrompt(
  session: SessionRow,
  content: string,
  images: ImageAttachment[] | undefined,
  options: PromptOptions,
  source: QueuedPrompt['source'] = 'platform',
): Promise<void> {
  const projectId = resolvePromptProjectId(session, options)
  const completion = promptBatcher.enqueue(session.id, {
    batchKey: options.batchKey ?? projectId ?? '__default__',
    dedupeKey: options.dedupeKey ?? (options.clientMessageId ? `message:${options.clientMessageId}` : undefined),
    value: { content, images, options, projectId, source, intent: options.intent },
  })
  schedulePromptBatchDrain(session.id)
  return completion
}

async function filterPromptIntents(_sessionId: string, entries: QueuedPrompt[]): Promise<QueuedPrompt[]> {
  const valid: QueuedPrompt[] = []
  for (const entry of entries) {
    const validation = await validatePromptIntent(entry.intent)
    if (validation.valid) {
      valid.push(entry)
      continue
    }
    log.info(
      { intent: entry.intent, reason: validation.reason },
      'stale prompt intent skipped before ACP send',
    )
  }
  return valid
}

function schedulePromptBatchDrain(sessionId: string): void {
  if (activePrompts.has(sessionId)) return
  queueMicrotask(() => {
    if (activePrompts.has(sessionId)) return
    void promptBatcher.flush(sessionId, async (inputs) => {
      const session = requirePromptSession(sessionId)
      await sendPromptBatchNow(session, inputs)
    }).catch((err: unknown) => {
      log.error({ err, sessionId }, 'session prompt batch drain failed')
    })
  })
}

function resolvePromptProjectId(session: SessionRow, options: PromptOptions): string | undefined {
  const sessionProjectId = session.project_id ?? undefined
  if (!options.contextProjectId || options.contextProjectId === sessionProjectId) return sessionProjectId
  if (!sessionProjectId) return options.contextProjectId
  throw new Error(`Project mismatch between session and prompt context: ${sessionProjectId}, ${options.contextProjectId}`)
}

async function sendPromptBatchNow(session: SessionRow, inputs: QueuedPrompt[]): Promise<void> {
  if (inputs.length === 0) return
  const sessionId = session.id
  const turnId = createTurnId()
  const startedAt = Date.now()
  const content = mergePromptContents(inputs)
  const modelContent = mergePromptContents(inputs, true)
  const projectId = inputs[0]?.projectId
  const promptLen = content.length
  const imageCount = inputs.reduce((total, input) => total + (input.images?.length ?? 0), 0)
  log.info(
    {
      sessionId,
      agentId: session.agent_id,
      projectId,
      taskId: session.task_id,
      turnId,
      promptLen,
      imageCount,
      inputCount: inputs.length,
      clientMessageIds: inputs.map((input) => input.options.clientMessageId).filter((id): id is string => !!id),
    },
    'prompt received',
  )

  activePrompts.add(sessionId)
  beginDeviceOrigin(sessionId, turnId, inputs)
  startPromptDiagnostics({
    turnId,
    sessionId,
    agentId: session.agent_id,
    projectId,
    startedAt,
    lastProgressAt: startedAt,
    lastProgress: 'prompt.received',
  })
  let activityEndReason: SessionActivityReason = 'prompt-done'
  log.debug({ sessionId, agentId: session.agent_id, turnId, activePromptCount: activePrompts.size }, 'prompt marked active')
  emitSessionActivity(sessionId, session.agent_id, 'running', 'prompt-started', turnId)
  const agentMessageId = createAgentMessageId()
  try {
    const promptImages: ImageAttachment[] = []
    const storedImages: StoredImageAttachment[] = []
    for (const [index, input] of inputs.entries()) {
      const humanMessageId = input.options.clientMessageId ?? `msg-${randomUUID().slice(0, 8)}`
      const inputStoredImages = await saveSessionImages({
        projectId,
        sessionId,
        messageId: humanMessageId,
        images: input.images,
      })
      const messageAttachments = inputStoredImages.length > 0 ? inputStoredImages : input.images
      // human 消息时间戳与回合开始时刻同源(按输入序号加毫秒偏移保持多条输入的先后),
      // 否则 append 晚于 startedAt,团队视图按 started_at 排序时 agent 回合会排到用户提问之前
      const humanMessage = observeSyncDbOperation(
        'message.human.append',
        { sessionId, turnId, messageId: humanMessageId },
        () => messageStore.append(sessionId, {
          id: humanMessageId,
          role: 'human',
          content: input.content,
          attachments: messageAttachments,
          senderId: input.options.senderId ?? null,
          senderName: input.options.senderName ?? null,
          senderRole: input.options.senderRole ?? 'user',
          timestamp: new Date(startedAt + index).toISOString(),
        }),
      )
      recordPromptProgress(sessionId, 'human.message.persisted')
      log.info(
        { sessionId, agentId: session.agent_id, turnId, messageId: humanMessage.id, contentLength: humanMessage.content.length, imageCount: input.images?.length ?? 0, timestamp: humanMessage.timestamp, senderRole: humanMessage.sender_role },
        'human message persisted',
      )
      await sessionPersistencePort.commitMutations(sessionId, 'interactive', [{
        type: 'session.touch',
        sessionId,
        timestamp: humanMessage.timestamp,
        advanceRead: true,
      }])
      const stored = observeSyncDbOperation(
        'session.user-event.append',
        { sessionId, turnId, messageId: humanMessage.id },
        () => eventStore.append(sessionId, {
          type: 'message.user',
          agentId: session.agent_id,
          messageId: humanMessage.id,
          role: 'human',
          payload: {
            messageId: humanMessage.id,
            content: input.content,
            attachments: messageAttachments || [],
            senderRole: humanMessage.sender_role,
            senderId: humanMessage.sender_id,
            senderName: humanMessage.sender_name,
          },
        }),
      )
      log.info(
        { sessionId, agentId: session.agent_id, turnId, eventId: stored.id, sequence: stored.sequence, messageId: stored.message_id },
        'human message event persisted',
      )
      events.emit('session:event', { sessionId, agentId: session.agent_id, event: stored })

      const inputImages = inputStoredImages.length > 0
        ? await loadStoredImagesForAcp(inputStoredImages)
        : input.images ?? []
      promptImages.push(...inputImages)
      const startOrder = storedImages.length
      storedImages.push(...inputStoredImages.map((image, index) => ({ ...image, order: startOrder + index + 1 })))
    }
    const agentMessage = observeSyncDbOperation(
      'message.agent-start.append',
      { sessionId, turnId, messageId: agentMessageId },
      () => messageStore.append(sessionId, {
        id: agentMessageId,
        role: 'agent',
        content: '',
        status: 'running',
        startedAt: new Date(startedAt).toISOString(),
      }),
    )
    startTurnProcess(sessionId, agentMessage.id)
    await sessionPersistencePort.commitMutations(sessionId, 'interactive', [{
      type: 'session.touch',
      sessionId,
      timestamp: agentMessage.timestamp,
      advanceRead: true,
    }])
    emitLifecycle(session.agent_id, sessionId, 'lifecycle.prompt_received', '正在准备 Agent...', agentMessage.id)
    const projectContext = resolveSessionProjectContext(
      session.agent_id,
      session.task_id ?? undefined,
      projectId,
      session.id,
    )
    recordPromptProgress(sessionId, 'acp.session.ensure.started')
    log.info({ sessionId, agentId: session.agent_id, turnId, acpSessionId: session.acp_session_id, projectId: projectContext.projectId, cwd: projectContext.cwd }, 'ACP ensure session start')
    const runtimeSnapshot = buildRuntimeStateSnapshot({
      sessionId,
      projectId: projectContext.projectId,
      cwd: projectContext.cwd,
    })
    const acpSessionId = await getRuntimePort().ensureSession(runtimeSnapshot)
    recordPromptProgress(sessionId, 'acp.session.ready')
    log.info({ sessionId, agentId: session.agent_id, turnId, acpSessionId }, 'ACP ensure session done')
    if (session.acp_session_id !== acpSessionId) {
      observeSyncDbOperation(
        'session.acp-mapping.update',
        { sessionId, turnId, acpSessionId },
        () => sessionStore.updateAcpSessionId(sessionId, acpSessionId),
      )
      log.info({ sessionId, agentId: session.agent_id, turnId, acpSessionId }, 'ACP Session mapped')
    }
    const acpContent = appendHiddenAttachmentNote(
      maybeWrapTeamLeaderPrompt(sessionId, modelContent, projectId),
      storedImages,
    )
    const acpImages = promptImages.length > 0 ? promptImages : undefined
    emitLifecycle(session.agent_id, sessionId, 'lifecycle.prompt_sent', '正在思考...', agentMessageId)
    recordPromptProgress(sessionId, 'acp.prompt.started')
    await getRuntimePort().prompt({
      agentId: session.agent_id,
      sessionId,
      content: acpContent,
      images: acpImages,
      diagnostics: { turnId, messageId: agentMessageId },
    })
    recordPromptProgress(sessionId, 'acp.prompt.resolved')
    log.info({ sessionId, agentId: session.agent_id, turnId, elapsedMs: Date.now() - startedAt }, 'prompt completed')
  } catch (err) {
    activityEndReason = 'prompt-error'
    const message = err instanceof Error ? err.message : String(err)
    try {
      await sessionManager.waitForPersistence(sessionId)
    } catch (persistenceError) {
      log.warn({
        err: persistenceError,
        sessionId,
        agentId: session.agent_id,
        turnId,
      }, 'prompt rejection raced terminal persistence; checking durable message state after failed drain')
    }
    const terminalMessage = messageStore.get(agentMessageId)
    if (terminalMessage?.status && terminalMessage.status !== 'running') {
      log.warn(
        {
          err,
          sessionId,
          agentId: session.agent_id,
          turnId,
          messageId: agentMessageId,
          messageStatus: terminalMessage.status,
          elapsedMs: Date.now() - startedAt,
        },
        'prompt rejected after agent message reached terminal state; skipping duplicate terminal',
      )
      if (terminalMessage.status === 'completed') {
        activityEndReason = 'prompt-done'
        recordPromptProgress(sessionId, 'prompt.late_error_ignored')
        return
      }
      throw err
    }
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
    try {
      await sessionManager.waitForPersistence(sessionId)
    } catch (err) {
      log.error({ err, sessionId, agentId: session.agent_id, turnId }, 'prompt persistence drain failed')
    }
    activePrompts.delete(sessionId)
    endDeviceOrigin(sessionId, turnId)
    finishPromptDiagnostics(sessionId, activityEndReason)
    log.info({ sessionId, agentId: session.agent_id, turnId, reason: activityEndReason, elapsedMs: Date.now() - startedAt, activePromptCount: activePrompts.size }, 'prompt cleanup complete')
    emitSessionActivity(sessionId, session.agent_id, 'idle', activityEndReason, turnId)
    schedulePromptBatchDrain(sessionId)
  }
}

function mergePromptContents(inputs: QueuedPrompt[], forModel = false): string {
  const inputContent = (input: QueuedPrompt): string => forModel
    ? input.options.modelContent ?? input.content
    : input.content
  if (inputs.length === 1) return inputs[0] ? inputContent(inputs[0]) : ''
  const sections = inputs.map((input, index) => [
    `### ${promptInputLabel(input)} ${index + 1}`,
    inputContent(input),
  ].join('\n'))
  return [
    `[系统合并通知] 当前会话在上一轮执行期间收到 ${inputs.length} 条新输入。请结合全部内容统一处理；不要遗漏用户消息，也不要将同一平台通知重复执行。`,
    ...sections,
  ].join('\n\n')
}

function promptInputLabel(input: QueuedPrompt): string {
  if (input.options.senderRole === 'agent') return `Agent 消息${input.options.senderName ? `（${input.options.senderName}）` : ''}`
  if (input.source === 'user') return '用户消息'
  return input.options.senderName ? `平台消息（${input.options.senderName}）` : '平台消息'
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
  void sessionPersistencePort.commitMutations(sessionId, 'background', [{
    type: 'session.stage.update',
    sessionId,
    stage: content,
    timestamp: new Date().toISOString(),
  }]).then(() => {
    const updated = sessionStore.get(sessionId)
    if (updated) events.emit('session:changed', { sessionId, data: { ...updated } })
  }).catch((err: unknown) => {
    log.error({ err, sessionId, agentId, eventType }, 'Session lifecycle stage persistence failed')
  })
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
  projectContext: { projectId?: string; cwd?: string },
): Promise<void> {
  try {
    const acpSessionId = await forkSessionInto({
      sourceSessionId: source.id,
      targetSessionId: copiedSessionId,
      projectContext,
    })
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
    // 清理失败的 copied 会话:ACP closeSession 和本地 delete 都包 .catch,
    // 防止任一抛错跳过后续清理。copyingSourceSessions.delete 放 finally 统一管控,
    // 保证源会话不会因清理失败而永久卡"复制中"。
    await getRuntimePort().closeSession(source.agent_id, copiedSessionId).catch((closeErr) => {
      log.warn(
        { copiedSessionId, agentId: source.agent_id, err: closeErr instanceof Error ? closeErr.message : String(closeErr) },
        '清理失败 copied 会话时 ACP closeSession 抛错,忽略',
      )
    })
    try {
      sessionStore.delete(copiedSessionId)
    } catch (deleteErr) {
      log.warn(
        { copiedSessionId, err: deleteErr instanceof Error ? deleteErr.message : String(deleteErr) },
        '清理失败 copied 会话时 sessionStore.delete 抛错,忽略',
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    events.emit('session:copy_failed', { sourceSessionId: source.id, targetSessionId: copiedSessionId, message })
    log.error({ err, sourceSessionId: source.id, copiedSessionId, agentId: source.agent_id }, 'Session copy failed')
  } finally {
    copyingSourceSessions.delete(source.id)
  }
}
