import { randomUUID } from 'node:crypto'
import { agentStore } from '../store/agents.js'
import { projectStore } from '../store/projects.js'
import {
  projectSecretaryStore,
  type CreateSecretaryInput,
  type ProjectSecretaryData,
} from '../store/project-secretaries.js'
import { secretaryRunStore, type SecretaryRunRow } from '../store/secretary-runs.js'
import { secretaryMailStore } from '../store/secretary-mail.js'
import { ruleStore } from '../store/rules.js'
import { sessionStore } from '../store/sessions.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import type { SessionDoneData } from '../types/ws-protocol.js'

const log = createChildLogger('project-secretary')
const activeRuns = new Set<string>()
export interface CreateProjectSecretaryInput extends CreateSecretaryInput {
  cron?: string
  watchSessionDone?: boolean
  watchTaskNeedsInput?: boolean
}
export interface UpdateProjectSecretaryInput {
  name?: string
  definitionPrompt?: string
  reportPrompt?: string
  executionAgentId?: string
  enabled?: boolean
  observeAll?: boolean
  observedAgentIds?: string[]
  cron?: string
}
export async function createProjectSecretary(input: CreateProjectSecretaryInput): Promise<ProjectSecretaryData> {
  validateSecretaryInput(input.projectId, input.executionAgentId, input.observedAgentIds ?? [])
  const row = projectSecretaryStore.create(input)
  let runtimeId: string | undefined
  let chatId: string | undefined
  try {
    const runtime = await sessionManager.createSession(row.execution_agent_id, undefined, row.project_id, 'secretary_runtime')
    const chat = await sessionManager.createSession(row.execution_agent_id, undefined, row.project_id, 'secretary_chat')
    runtimeId = runtime.id
    chatId = chat.id
    sessionStore.updateTitle(runtime.id, `${row.name} 后台运行`)
    sessionStore.updateTitle(chat.id, `${row.name} 对话`)
    projectSecretaryStore.setSessions(row.id, runtime.id, chat.id)
    configureTriggers(row.id, input)
    emitUpdate(row.project_id)
    log.info({ secretaryId: row.id, projectId: row.project_id, runtimeSessionId: runtime.id, chatSessionId: chat.id }, '项目秘书已创建')
    return projectSecretaryStore.getData(row.id)!
  } catch (err) {
    if (runtimeId) sessionStore.delete(runtimeId)
    if (chatId) sessionStore.delete(chatId)
    projectSecretaryStore.delete(row.id)
    throw err
  }
}
export function listProjectSecretaries(projectId: string): ProjectSecretaryData[] {
  requireProject(projectId)
  return projectSecretaryStore.listData(projectId)
}
export function getProjectSecretary(id: string, projectId: string): ProjectSecretaryData {
  const secretary = requireSecretary(id, projectId)
  return projectSecretaryStore.getData(secretary.id)!
}

export async function updateProjectSecretary(
  id: string,
  projectId: string,
  input: UpdateProjectSecretaryInput,
): Promise<ProjectSecretaryData> {
  const current = requireSecretary(id, projectId)
  if (input.executionAgentId && input.executionAgentId !== current.execution_agent_id) {
    validateSecretaryInput(projectId, input.executionAgentId, input.observedAgentIds ?? projectSecretaryStore.getData(id)!.observedAgentIds)
    let runtimeId: string | undefined
    let chatId: string | undefined
    try {
      const runtime = await sessionManager.createSession(input.executionAgentId, undefined, projectId, 'secretary_runtime')
      runtimeId = runtime.id
      const chat = await sessionManager.createSession(input.executionAgentId, undefined, projectId, 'secretary_chat')
      chatId = chat.id
      const next = projectSecretaryStore.update(id, input)
      sessionStore.updateTitle(runtime.id, `${next.name} 后台运行`)
      sessionStore.updateTitle(chat.id, `${next.name} 对话`)
      projectSecretaryStore.setSessions(id, runtime.id, chat.id)
      if (current.runtime_session_id) sessionStore.delete(current.runtime_session_id)
      if (current.chat_session_id) sessionStore.delete(current.chat_session_id)
    } catch (err) {
      if (runtimeId) sessionStore.delete(runtimeId)
      if (chatId) sessionStore.delete(chatId)
      throw err
    }
  } else {
    if (input.observedAgentIds) validateSecretaryInput(projectId, current.execution_agent_id, input.observedAgentIds)
    projectSecretaryStore.update(id, input)
  }
  if (input.cron !== undefined) reconfigureCron(id, projectId, input.cron)
  if (projectSecretaryStore.get(id)?.enabled) void drainSecretaryRuns(id)
  emitUpdate(projectId)
  return projectSecretaryStore.getData(id)!
}

export function deleteProjectSecretary(id: string, projectId: string): void {
  const secretary = requireSecretary(id, projectId)
  deleteSecretaryRules(id, projectId)
  if (secretary.runtime_session_id) sessionStore.delete(secretary.runtime_session_id)
  if (secretary.chat_session_id) sessionStore.delete(secretary.chat_session_id)
  projectSecretaryStore.delete(id)
  emitUpdate(projectId)
}

export function enqueueProjectSecretaryRun(
  id: string,
  projectId: string,
  input: { eventType: string; sourceId?: string; payload?: Record<string, unknown>; triggerId?: string; dedupeKey?: string },
): SecretaryRunRow {
  const secretary = requireSecretary(id, projectId)
  if (!secretary.enabled) throw new Error('秘书已停用')
  const run = secretaryRunStore.enqueue({
    secretaryId: id,
    triggerId: input.triggerId,
    eventType: input.eventType,
    sourceId: input.sourceId,
    payload: input.payload,
    dedupeKey: input.dedupeKey ?? `${id}:${input.eventType}:${input.sourceId ?? randomUUID()}`,
  })
  emitUpdate(projectId)
  void drainSecretaryRuns(id)
  return run
}

export function runProjectSecretaryNow(id: string, projectId: string): SecretaryRunRow {
  return enqueueProjectSecretaryRun(id, projectId, {
    eventType: 'manual',
    dedupeKey: `${id}:manual:${Date.now()}`,
    payload: { reason: '用户手动运行' },
  })
}

export function runProjectSecretaryTick(id: string, projectId: string, triggerId?: string): SecretaryRunRow {
  return enqueueProjectSecretaryRun(id, projectId, {
    triggerId,
    eventType: 'cron',
    dedupeKey: `${id}:cron:${triggerId ?? 'manual'}:${new Date().toISOString().slice(0, 16)}`,
    payload: { reason: '定时触发' },
  })
}

export async function resumeProjectSecretaryRuns(): Promise<void> {
  const requeued = secretaryRunStore.requeueRunning()
  if (requeued > 0) log.info({ requeued }, '服务重启后秘书运行重新排队')
  for (const secretary of listAllSecretaries()) {
    if (secretary.enabled) void drainSecretaryRuns(secretary.id)
  }
}

export function listSecretaryThreads(id: string, projectId: string, unreadOnly = false) {
  requireSecretary(id, projectId)
  return secretaryMailStore.list(id, { unreadOnly })
}

export function getSecretaryThread(id: string, projectId: string, threadId: string) {
  requireSecretary(id, projectId)
  const thread = secretaryMailStore.get(threadId)
  if (!thread || thread.secretaryId !== id) throw new Error('秘书邮件不存在')
  return thread
}

export function markSecretaryThreadRead(id: string, projectId: string, threadId: string) {
  getSecretaryThread(id, projectId, threadId)
  const result = secretaryMailStore.markRead(threadId)
  emitUpdate(projectId)
  return result
}

export function archiveSecretaryThread(id: string, projectId: string, threadId: string) {
  getSecretaryThread(id, projectId, threadId)
  const result = secretaryMailStore.archive(threadId)
  emitUpdate(projectId)
  return result
}

export async function sendSecretaryChat(id: string, projectId: string, content: string): Promise<{ sessionId: string }> {
  const secretary = requireSecretary(id, projectId)
  if (!secretary.chat_session_id) throw new Error('秘书对话 Session 尚未初始化')
  const text = content.trim()
  if (!text) throw new Error('消息不能为空')
  await sessionManager.enqueuePrompt(secretary.chat_session_id, text, undefined, {
    senderRole: 'user',
    senderId: id,
    senderName: secretary.name,
  })
  return { sessionId: secretary.chat_session_id }
}

export function secretaryForSession(sessionId: string) {
  return projectSecretaryStore.findBySession(sessionId)
}

function configureTriggers(id: string, input: CreateProjectSecretaryInput): void {
  const projectId = projectSecretaryStore.get(id)?.project_id
  if (!projectId) return
  if (input.cron?.trim()) {
    const trigger = projectSecretaryStore.createTrigger({ secretaryId: id, type: 'cron', cron: input.cron.trim() })
    ruleStore.create({
      name: `${projectSecretaryStore.get(id)?.name ?? '秘书'} 定时汇报`,
      description: '项目秘书定时检查',
      cron: input.cron.trim(),
      action: 'secretary_tick',
      actionConfig: { secretary_id: id, trigger_id: trigger.id },
      enabled: true,
      projectId,
      createdBy: `secretary:${id}`,
    })
  }
  if (input.watchSessionDone !== false) {
    projectSecretaryStore.createTrigger({ secretaryId: id, type: 'session_done', eventType: 'session:committed_done' })
  }
  if (input.watchTaskNeedsInput) {
    projectSecretaryStore.createTrigger({ secretaryId: id, type: 'task_needs_input', eventType: 'task:update' })
  }
}

function reconfigureCron(secretaryId: string, projectId: string, cron: string): void {
  deleteSecretaryRules(secretaryId, projectId)
  projectSecretaryStore.deleteTriggersByType(secretaryId, 'cron')
  if (!cron.trim()) return
  const trigger = projectSecretaryStore.createTrigger({ secretaryId, type: 'cron', cron: cron.trim() })
  ruleStore.create({
    name: `${projectSecretaryStore.get(secretaryId)?.name ?? '秘书'} 定时汇报`,
    description: '项目秘书定时检查',
    cron: cron.trim(),
    action: 'secretary_tick',
    actionConfig: { secretary_id: secretaryId, trigger_id: trigger.id },
    enabled: true,
    projectId,
    createdBy: `secretary:${secretaryId}`,
  })
}

function validateSecretaryInput(projectId: string, executionAgentId: string, observedAgentIds: string[]): void {
  requireProject(projectId)
  const executionAgent = agentStore.get(executionAgentId)
  if (!executionAgent || executionAgent.project_id !== projectId) throw new Error('执行 Agent 不属于当前项目')
  for (const agentId of observedAgentIds) {
    const agent = agentStore.get(agentId)
    if (!agent || agent.project_id !== projectId) throw new Error('观察 Agent 不属于当前项目')
  }
}

function requireProject(projectId: string): void {
  if (!projectStore.get(projectId)) throw new Error('项目不存在')
}

function requireSecretary(id: string, projectId: string) {
  const secretary = projectSecretaryStore.get(id)
  if (!secretary || secretary.project_id !== projectId) throw new Error('秘书不存在或不属于当前项目')
  return secretary
}

function deleteSecretaryRules(secretaryId: string, projectId: string): void {
  for (const rule of ruleStore.list(projectId)) {
    if (rule.action === 'secretary_tick' && rule.action_config.secretary_id === secretaryId) ruleStore.delete(rule.id)
  }
}

async function drainSecretaryRuns(secretaryId: string): Promise<void> {
  if (activeRuns.has(secretaryId)) return
  activeRuns.add(secretaryId)
  try {
    while (true) {
      const secretary = projectSecretaryStore.get(secretaryId)
      if (!secretary?.enabled || !secretary.runtime_session_id) return
      const run = secretaryRunStore.claimNext(secretaryId)
      if (!run) return
      try {
        const payload = secretaryRunStore.parsePayload(run)
        const prompt = buildRunPrompt(secretary.name, run, payload)
        await sessionManager.enqueuePrompt(secretary.runtime_session_id, prompt, undefined, {
          senderRole: 'secretary',
          senderId: secretary.id,
          senderName: secretary.name,
        })
        secretaryRunStore.finish(run.id, 'succeeded')
        projectSecretaryStore.markRun(secretary.id, null)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        secretaryRunStore.finish(run.id, 'failed', message)
        projectSecretaryStore.markRun(secretary.id, message)
        log.error({ err, secretaryId, runId: run.id }, '秘书运行失败')
      }
    }
  } catch (err) {
    log.error({ err, secretaryId }, '秘书运行队列处理失败')
  } finally {
    activeRuns.delete(secretaryId)
  }
}

function buildRunPrompt(name: string, run: SecretaryRunRow, payload: Record<string, unknown>): string {
  return [
    `这是 ${name} 的一次项目秘书运行。`,
    `触发类型: ${run.event_type}`,
    `来源: ${run.source_id ?? '无'}`,
    `触发上下文:\n${JSON.stringify(payload, null, 2)}`,
    '请先读取秘书系统提示中的定义和汇报要求，再判断是否有值得用户关注的变化。需要汇报时调用 secretary.report；没有价值时直接结束。',
  ].join('\n\n')
}

function listAllSecretaries() {
  const ids = projectStore.list().map((project) => project.id)
  return ids.flatMap((projectId) => projectSecretaryStore.list(projectId))
}

function listSecretariesSafe(projectId: string) {
  try {
    return projectSecretaryStore.list(projectId)
  } catch (err) {
    log.error({ err, projectId }, '读取项目秘书失败')
    return []
  }
}

function getSecretaryDataSafe(secretaryId: string): ProjectSecretaryData | undefined {
  try {
    return projectSecretaryStore.getData(secretaryId)
  } catch (err) {
    log.error({ err, secretaryId }, '读取项目秘书配置失败')
    return undefined
  }
}

function emitUpdate(projectId: string): void {
  events.emit('secretary:update', { projectId })
}

events.on('session:committed_done', (event: SessionDoneData) => {
  const session = sessionStore.get(event.sessionId)
  if (!session || session.purpose === 'secretary_runtime' || session.purpose === 'secretary_chat' || !session.project_id) return
  for (const secretary of listSecretariesSafe(session.project_id)) {
    if (!secretary.enabled) continue
    const data = getSecretaryDataSafe(secretary.id)
    const observed = data?.observeAll || data?.observedAgentIds.includes(session.agent_id)
    const trigger = data?.triggers.find((item) => item.type === 'session_done' && item.enabled)
    if (!observed || !trigger) continue
    try {
      enqueueProjectSecretaryRun(secretary.id, session.project_id, {
        triggerId: trigger.id,
        eventType: 'session:committed_done',
        sourceId: event.messageId,
        dedupeKey: `${secretary.id}:session_done:${event.messageId}`,
        payload: { sessionId: event.sessionId, agentId: event.agentId, stopReason: event.stopReason },
      })
    } catch (err) {
      log.error({ err, secretaryId: secretary.id, sessionId: event.sessionId }, 'Session 完成触发秘书失败')
    }
  }
})

events.on('task:update', (event) => {
  const taskStatus = event.data.status
  if (taskStatus !== 'needs_input' && taskStatus !== 'blocked') return
  const taskProjectId = typeof event.data.project_id === 'string' ? event.data.project_id : undefined
  if (!taskProjectId) return
  for (const secretary of listSecretariesSafe(taskProjectId)) {
    if (!secretary.enabled) continue
    const data = getSecretaryDataSafe(secretary.id)
    const trigger = data?.triggers.find((item) => item.type === 'task_needs_input' && item.enabled)
    if (!data || !trigger) continue
    const assignedAgentId = typeof event.data.assigned_agent_id === 'string'
      ? event.data.assigned_agent_id
      : typeof event.data.assignedAgentId === 'string'
        ? event.data.assignedAgentId
        : typeof event.data.initiator_agent_id === 'string'
          ? event.data.initiator_agent_id
          : typeof event.data.initiatorAgentId === 'string'
            ? event.data.initiatorAgentId
            : undefined
    if (!data.observeAll && (!assignedAgentId || !data.observedAgentIds.includes(assignedAgentId))) continue
    const taskVersion = typeof event.data.updated_at === 'string'
      ? event.data.updated_at
      : typeof event.data.updatedAt === 'string'
        ? event.data.updatedAt
        : `${String(event.data.event ?? 'status')}:${Date.now()}`
    try {
      enqueueProjectSecretaryRun(secretary.id, taskProjectId, {
        triggerId: trigger.id,
        eventType: 'task:update',
        sourceId: event.taskId,
        dedupeKey: `${secretary.id}:task:${event.taskId}:${String(taskStatus)}:${taskVersion}`,
        payload: { taskId: event.taskId, status: taskStatus, task: event.data },
      })
    } catch (err) {
      log.error({ err, secretaryId: secretary.id, taskId: event.taskId }, 'Task 状态触发秘书失败')
    }
  }
})
