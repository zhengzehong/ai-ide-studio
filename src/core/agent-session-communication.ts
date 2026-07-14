import { agentStore } from '../store/agents.js'
import {
  agentSessionMessageStore,
  agentSessionWatchStore,
  type AgentSessionMessageRow,
  type AgentSessionWatchRow,
} from '../store/agent-session-communication.js'
import { messageStore, sessionStore, type MessageRow, type SessionListRow, type SessionRow } from '../store/sessions.js'
import { globalAssistantStore } from '../store/global-assistant.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { sessionManager } from './sessions.js'
import {
  buildAgentSessionMessagePrompt,
  buildAgentSessionReplyReminderPrompt,
  buildAgentSessionWatchPrompt,
  buildAgentTaskWatchPrompt,
} from './agent-session-prompts.js'

const log = createChildLogger('agent-session-communication')
const DEFAULT_SESSION_LIST_LIMIT = 20
const DEFAULT_MESSAGE_LIST_LIMIT = 10

export interface SendAgentSessionMessageInput {
  context: {
    agentId?: string
    sessionId?: string
    projectId?: string
  }
  targetAgentId?: string
  targetSessionId?: string
  content: string
  relatedInfo?: Record<string, unknown>
  needReply?: boolean
}

export interface CreateAgentSessionWatchInput {
  context: {
    agentId?: string
    sessionId?: string
    projectId?: string
  }
  sessionId: string
  once?: boolean
  relatedInfo?: Record<string, unknown>
}

export interface CreateAgentTaskWatchInput {
  context: {
    agentId?: string
    sessionId?: string
    projectId?: string
  }
  taskId: string
  relatedInfo?: Record<string, unknown>
}

export interface TaskWatchTriggerInput {
  taskId: string
  stepId?: string
  trigger: 'step_done' | 'step_blocked' | 'task_completed' | 'task_reverted'
  taskSnapshot: {
    title: string
    status: string
  }
  stepSnapshot?: {
    title: string
    status: string
  }
}

export interface TaskWatchTriggerContext {
  taskId: string
  trigger: TaskWatchTriggerInput['trigger']
  taskTitle: string
  taskStatus: string
  stepId?: string
  stepTitle?: string
  stepStatus?: string
}

export const agentSessionCommunicationService = {
  async sendMessage(input: SendAgentSessionMessageInput): Promise<{ message: AgentSessionMessageRow; targetSession: SessionRow }> {
    const sourceSession = requireContextSession(input.context)
    const sourceAgent = requireContextAgent(input.context, sourceSession)
    const projectId = resolveContextProjectId(input.context.projectId, sourceSession.project_id)
    const content = input.content.trim()
    if (!content) throw new Error('content 不能为空')
    const targetSession = await resolveTargetSession({
      sourceProjectId: projectId,
      targetAgentId: input.targetAgentId,
      targetSessionId: input.targetSessionId,
    })

    const message = agentSessionMessageStore.create({
      projectId,
      sourceAgentId: sourceAgent.id,
      sourceSessionId: sourceSession.id,
      targetAgentId: targetSession.agent_id,
      targetSessionId: targetSession.id,
      content,
      relatedInfo: input.relatedInfo,
      needReply: input.needReply,
    })
    const prompt = buildAgentSessionMessagePrompt({ message, sourceAgent, targetSessionId: targetSession.id })
    enqueueMessagePrompt(message.id, targetSession.id, prompt, message.project_id)
    agentSessionMessageStore.markLatestReplySatisfiedByResponse(message)
    return { message, targetSession }
  },

  listSessions(agentId: string, projectId: string | undefined, limit = DEFAULT_SESSION_LIST_LIMIT): SessionListRow[] {
    assertAgentProject(agentId, projectId)
    return sessionStore.listWithRuntimeState(agentId, projectId, (sessionId) => sessionManager.isPromptActive(sessionId)).slice(0, normalizeLimit(limit, DEFAULT_SESSION_LIST_LIMIT))
  },

  listMessages(sessionId: string, projectId: string | undefined, limit = DEFAULT_MESSAGE_LIST_LIMIT): MessageRow[] {
    const session = requireVisibleSession(sessionId, projectId)
    return messageStore.list(session.id, { limit: normalizeLimit(limit, DEFAULT_MESSAGE_LIST_LIMIT), includeToolCalls: false, includeLatestToolCalls: false })
  },

  createWatch(input: CreateAgentSessionWatchInput): AgentSessionWatchRow {
    const watcherSession = requireContextSession(input.context)
    const watcherAgent = requireContextAgent(input.context, watcherSession)
    const projectId = resolveContextProjectId(input.context.projectId, watcherSession.project_id)
    const watchedSession = requireVisibleSession(input.sessionId, projectId)
    // 自监视守卫:Agent 在自己所在会话上调 watch 自己,回调唤起自己 → 再次 watch → 无限递归。
    // 即便 once=true 也只是"触发一次",但那一触发仍会回到同会话发消息,可能继续触发别的副作用,
    // 语义上"监视自己"本就无意义,统一拒绝。
    if (watcherSession.id === watchedSession.id) {
      throw new Error('不能监视当前会话')
    }
    const watchedAgent = agentStore.get(watchedSession.agent_id)
    if (!watchedAgent) throw new Error(`Agent not found: ${watchedSession.agent_id}`)
    return agentSessionWatchStore.create({
      projectId,
      watcherAgentId: watcherAgent.id,
      watcherSessionId: watcherSession.id,
      watchedAgentId: watchedAgent.id,
      watchedSessionId: watchedSession.id,
      relatedInfo: input.relatedInfo,
      once: input.once,
    })
  },

  cancelWatch(watchId: string, context: { agentId?: string; sessionId?: string }): AgentSessionWatchRow {
    if (!context.agentId || !context.sessionId) throw new Error('当前工具上下文缺少 agentId 或 sessionId')
    const watch = agentSessionWatchStore.cancel(watchId, context.sessionId, context.agentId)
    if (!watch || watch.status !== 'cancelled') throw new Error(`Watch 不存在或不属于当前会话: ${watchId}`)
    return watch
  },

  createTaskWatch(input: CreateAgentTaskWatchInput): AgentSessionWatchRow {
    const watcherSession = requireContextSession(input.context)
    const watcherAgent = requireContextAgent(input.context, watcherSession)
    const projectId = resolveContextProjectId(input.context.projectId, watcherSession.project_id)
    return agentSessionWatchStore.createTaskWatch({
      projectId,
      watcherAgentId: watcherAgent.id,
      watcherSessionId: watcherSession.id,
      taskId: input.taskId,
      relatedInfo: input.relatedInfo,
    })
  },

  triggerTaskWatch(input: TaskWatchTriggerInput): void {
    const watches = agentSessionWatchStore.listActiveByTask(input.taskId)
    if (watches.length === 0) return
    for (const watch of watches) {
      const triggered = agentSessionWatchStore.markTriggered(watch.id, {
        once: false,
      })
      if (!triggered) continue
      const prompt = buildAgentTaskWatchPrompt({
        watch: triggered,
        taskId: input.taskId,
        trigger: input.trigger,
        taskSnapshot: input.taskSnapshot,
        stepSnapshot: input.stepSnapshot,
        stepId: input.stepId,
      })
      enqueueWatchPrompt(watch.id, watch.watcher_session_id, prompt, watch.project_id)
    }
  },

  triggerTaskWatchFromTask(input: TaskWatchTriggerContext): void {
    try {
      agentSessionCommunicationService.triggerTaskWatch({
        taskId: input.taskId,
        stepId: input.stepId,
        trigger: input.trigger,
        taskSnapshot: { title: input.taskTitle, status: input.taskStatus },
        stepSnapshot: input.stepTitle && input.stepStatus
          ? { title: input.stepTitle, status: input.stepStatus }
          : undefined,
      })
    } catch (err) {
      log.warn({ err, taskId: input.taskId, trigger: input.trigger }, 'failed to trigger task watch')
    }
  },

  handleSessionDone(ev: { sessionId: string; agentId?: string | null; messageId?: string; turnId?: string }): void {
    handleNeedReplyReminders(ev.sessionId)
    handleWatchTriggers(ev)
  },
}

events.on('session:done', (ev) => {
  agentSessionCommunicationService.handleSessionDone(ev)
})

function enqueueMessagePrompt(messageId: string, sessionId: string, prompt: string, projectId?: string | null): void {
  void sessionManager.enqueuePrompt(
    sessionId,
    prompt,
    undefined,
    projectId ? { contextProjectId: projectId } : undefined,
  )
    .then(() => {
      agentSessionMessageStore.updatePromptCompleted(messageId)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      agentSessionMessageStore.updatePromptFailed(messageId, message)
      log.error({ err, messageId, sessionId }, 'Agent session message prompt failed')
    })
}

function enqueueWatchPrompt(watchId: string, sessionId: string, prompt: string, projectId?: string | null): void {
  void sessionManager.enqueuePrompt(
    sessionId,
    prompt,
    undefined,
    projectId ? { contextProjectId: projectId } : undefined,
  )
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      agentSessionWatchStore.markFailed(watchId, message)
      log.error({ err, watchId, sessionId }, 'Agent session watch prompt failed')
    })
}

function handleNeedReplyReminders(targetSessionId: string): void {
  const pending = agentSessionMessageStore.listPendingRepliesForTargetSession(targetSessionId)
  for (const message of pending) {
    const sourceAgent = agentStore.get(message.source_agent_id)
    if (!sourceAgent) continue
    const reminded = agentSessionMessageStore.markReminderSent(message.id)
    if (!reminded) continue
    const prompt = buildAgentSessionReplyReminderPrompt({ message: reminded, sourceAgent, targetSessionId })
    enqueueMessagePrompt(reminded.id, targetSessionId, prompt, reminded.project_id)
  }
}

function handleWatchTriggers(ev: { sessionId: string; agentId?: string | null; messageId?: string; turnId?: string }): void {
  const watches = agentSessionWatchStore.listActiveByWatchedSession(ev.sessionId)
  for (const watch of watches) {
    const once = watch.once === 1
    const triggered = agentSessionWatchStore.markTriggered(watch.id, {
      messageId: ev.messageId,
      turnId: ev.turnId,
      once,
    })
    if (!triggered) continue
    if (agentSessionMessageStore.hasMessageBetweenSince(watch.watched_session_id, watch.watcher_session_id, watch.created_at)) {
      continue
    }
    const watchedAgent = agentStore.get(watch.watched_agent_id)
    if (!watchedAgent) continue
    const prompt = buildAgentSessionWatchPrompt({ watch: triggered, watchedAgent, messageId: ev.messageId })
    enqueueWatchPrompt(watch.id, watch.watcher_session_id, prompt, watch.project_id)
  }
}

async function resolveTargetSession(input: {
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
  assertAgentProject(input.targetAgentId!, input.sourceProjectId)
  return sessionManager.createSession(input.targetAgentId!, undefined, input.sourceProjectId)
}

function requireMessageTargetSession(sessionId: string, projectId: string | undefined): SessionRow {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`Session 不存在: ${sessionId}`)
  if (projectId && session.project_id !== projectId && !isGlobalAssistantSession(session)) {
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

function requireContextSession(context: { sessionId?: string; projectId?: string }): SessionRow {
  if (!context.sessionId) throw new Error('当前工具上下文缺少 sessionId')
  const session = sessionStore.get(context.sessionId)
  if (!session) throw new Error(`Session 不存在: ${context.sessionId}`)
  if (context.projectId && session.project_id !== context.projectId && !isGlobalAssistantSession(session)) {
    throw new Error('会话不属于当前项目')
  }
  return session
}

function requireContextAgent(context: { agentId?: string }, session: SessionRow) {
  if (!context.agentId) throw new Error('当前工具上下文缺少 agentId')
  if (context.agentId !== session.agent_id) throw new Error('当前 Agent 与会话不匹配')
  const agent = agentStore.get(context.agentId)
  if (!agent) throw new Error(`Agent not found: ${context.agentId}`)
  return agent
}

function requireVisibleSession(sessionId: string, projectId: string | undefined): SessionRow {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`Session 不存在: ${sessionId}`)
  if (projectId && session.project_id !== projectId) throw new Error('会话不属于当前项目')
  if (!projectId && session.project_id) return session
  return session
}

function isGlobalAssistantSession(session: SessionRow): boolean {
  const assistant = globalAssistantStore.getBySessionId(session.id)
  return assistant?.agent_id === session.agent_id
}

function resolveContextProjectId(contextProjectId: string | undefined, sessionProjectId: string | null): string | undefined {
  if (contextProjectId && sessionProjectId && contextProjectId !== sessionProjectId) throw new Error('会话不属于当前项目')
  return contextProjectId ?? sessionProjectId ?? undefined
}

function assertAgentProject(agentId: string, projectId: string | undefined): void {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  if (projectId && agent.project_id !== projectId) throw new Error(`Project mismatch: Agent ${agentId} is outside current project`)
}

function normalizeLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), 100)
}
