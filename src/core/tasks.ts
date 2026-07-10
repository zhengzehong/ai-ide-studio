import {
  taskAttachmentStore,
  taskStore,
  taskEventStore,
  type CreateTaskInput,
  type TaskAttachmentRow,
} from '../store/tasks.js'
import { taskStepStore } from '../store/task-steps.js'
import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { emitTaskLifecycleEvent } from './task-lifecycle-events.js'
import { createChildLogger } from './logger.js'
import { appendHiddenAttachmentNote, loadStoredImagesForAcp, type StoredImageAttachment } from './image-attachments.js'
import { buildTaskPrompt, getTaskMode } from './task-prompt.js'

const log = createChildLogger('task')

export type AgentSessionMode = 'existing' | 'new_each' | 'new_fixed'

export interface AssignTaskInput {
  taskId: string
  agentId: string
  sessionId?: string
  sessionMode?: AgentSessionMode
  promptTemplate?: string
  ruleName?: string
}

interface CreateTaskManagerInput extends CreateTaskInput {
  selfExecuteAgentId?: string
  selfExecuteSessionId?: string
}

export const taskManager = {
  async createTask(input: CreateTaskManagerInput) {
    if (!input.title?.trim()) throw new Error('任务标题不能为空')
    if (!input.description?.trim()) throw new Error('任务描述不能为空')
    if (input.selfExecute) {
      if (!input.selfExecuteAgentId) throw new Error('selfExecute=true 需要当前 Agent')
      if (!input.selfExecuteSessionId) throw new Error('selfExecute=true 需要当前会话')
      validateTaskAssignment(input.selfExecuteAgentId, input.projectId, input.selfExecuteSessionId)
    }
    const task = taskStore.create(input)
    log.info({ taskId: task.id, title: task.title, selfExecute: input.selfExecute }, '任务已创建')

    events.emit('task:update', {
      taskId: task.id,
      data: { ...task, event: 'created' },
    })
    emitTaskLifecycleEvent(task, 'created', null)

    if (input.selfExecute) {
      const agentId = input.selfExecuteAgentId!
      const sessionId = input.selfExecuteSessionId!
      taskStore.assignAgent(task.id, agentId)
      const step = taskStepStore.create({
        taskId: task.id,
        title: task.title,
        description: task.description ?? undefined,
        assigneeAgentId: agentId,
        sessionId,
      })
      taskStepStore.updateStatus(step.id, 'running')
      taskStore.updateStatus(task.id, 'running', '已自认领')
      taskStore.linkSession(task.id, sessionId)
      taskStore.updateAgentReportStatus(task.id, 'in_progress')
      taskEventStore.append(task.id, {
        type: 'step_added',
        payload: {
          stepId: step.id,
          title: step.title,
          assignee: agentId,
          dependsOn: [],
          selfExecute: true,
        },
      })
      const updated = taskStore.get(task.id)
      if (!updated) throw new Error('任务自认领后无法找到任务')
      events.emit('task:update', {
        taskId: task.id,
        data: {
          ...updated,
          event: 'self_claimed',
          defaultStepId: step.id,
          sessionId,
          assignedAgentId: agentId,
        },
      })
      emitTaskLifecycleEvent(updated, 'self_claimed', task.status)
      log.info({ taskId: task.id, stepId: step.id, sessionId }, '自认领任务已创建默认 step,跳过 prompt 注入')
      return { ...updated, sessionId, defaultStepId: step.id }
    }

    return task
  },

  async assignTask(input: AssignTaskInput) {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`Task not found: ${input.taskId}`)
    if (!input.agentId) throw new Error('agentId is required')

    const sessionMode = resolveSessionMode(input.sessionMode, input.sessionId)
    validateSessionModeTarget(sessionMode, input.sessionId)
    validateTaskAssignment(
      input.agentId,
      task.project_id,
      sessionMode === 'existing' || (sessionMode === 'new_fixed' && input.sessionId) ? input.sessionId : undefined,
    )

    const previousStatus = task.status
    try {
      const session = await resolveTaskSession({
        agentId: input.agentId,
        projectId: task.project_id,
        taskId: input.taskId,
        sessionId: input.sessionId,
        sessionMode,
      })

      taskStore.assignAgent(input.taskId, input.agentId)
      taskStore.updateStatus(input.taskId, 'running', '已分派给 Agent')
      taskStore.linkSession(input.taskId, session.id)
      const updated = taskStore.get(input.taskId)
      if (!updated) throw new Error('任务分派后无法找到任务')
      log.info(
        { taskId: input.taskId, sessionId: session.id, agentId: input.agentId, reuse: session.reuse },
        '任务已分派',
      )

      events.emit('task:update', {
        taskId: input.taskId,
        data: { ...updated, sessionId: session.id, assignedAgentId: input.agentId, event: 'assigned' },
      })
      emitTaskLifecycleEvent(updated, 'assigned', previousStatus)

      const prompt =
        input.promptTemplate ||
        buildTaskPrompt(
          { id: task.id, title: task.title, description: task.description, source: task.source },
          { sessionReuse: session.reuse, ruleName: input.ruleName, mode: getTaskMode(task.execution_mode_id) },
        )
      const taskImages = toStoredImageAttachments(taskAttachmentStore.list(input.taskId))
      const promptWithAttachments = appendHiddenAttachmentNote(prompt, taskImages)
      const promptImages = taskImages.length > 0 ? await loadStoredImagesForAcp(taskImages) : undefined
      const queued = promptImages
        ? sessionManager.enqueuePrompt(session.id, promptWithAttachments, promptImages)
        : sessionManager.enqueuePrompt(session.id, promptWithAttachments)
      queued.catch((err: Error) => {
        log.error({ err, taskId: input.taskId, sessionId: session.id }, 'Task prompt failed')
        taskStore.updateStatus(input.taskId, 'needs_input', `Execution failed: ${err.message}`)
        const failed = taskStore.get(input.taskId)
        events.emit('task:update', {
          taskId: input.taskId,
          data: failed ? { ...failed, event: 'prompt_failed' } : { event: 'prompt_failed' },
        })
        if (failed) emitTaskLifecycleEvent(failed, 'prompt_failed', 'running')
      })

      return { ...updated, sessionId: session.id }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      taskStore.updateStatus(input.taskId, 'needs_input', `分派失败: ${message}`)
      const failed = taskStore.get(input.taskId)
      events.emit('task:update', {
        taskId: input.taskId,
        data: failed ? { ...failed, event: 'assign_failed' } : { event: 'assign_failed' },
      })
      if (failed) emitTaskLifecycleEvent(failed, 'assign_failed', previousStatus)
      throw err
    }
  },

  updateTask(taskId: string, status?: string, stage?: string, changeType?: string, reason?: string) {
    const task = taskStore.get(taskId)
    if (!task) throw new Error(`Task 不存在: ${taskId}`)

    if (status) {
      taskStore.updateStatus(taskId, status, stage)
      if (reason) {
        taskEventStore.append(taskId, {
          type: 'manual_status_change',
          payload: { from_status: task.status, to_status: status, reason },
        })
      }
      log.info({ taskId, status, stage, reason }, '任务状态变更')
    } else if (stage !== undefined) {
      taskStore.updateStatus(taskId, task.status, stage)
      log.info({ taskId, stage }, '任务阶段更新')
    }

    const updated = taskStore.get(taskId)
    if (!updated) return undefined
    events.emit('task:update', {
      taskId,
      data: { ...updated, event: 'updated' },
    })
    const lifecycleChange = changeType ?? (status && status !== task.status ? 'status_changed' : 'progress_updated')
    emitTaskLifecycleEvent(updated, lifecycleChange, task.status)

    return updated
  },

  reportTask(input: {
    taskId: string
    agentStatus: 'milestone' | 'blocked' | 'done'
    reportMd?: string
    stage?: string
  }) {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`Task 不存在: ${input.taskId}`)

    const previousStatus = task.status
    let nextStatus = task.status
    if (input.agentStatus === 'milestone') {
      if (task.status === 'needs_input') nextStatus = 'running'
    } else if (input.agentStatus === 'blocked') {
      nextStatus = 'needs_input'
    } else if (input.agentStatus === 'done') {
      nextStatus = 'needs_input'
    }

    const stage = input.stage ?? task.stage
    if (nextStatus !== task.status) {
      taskStore.updateStatus(input.taskId, nextStatus, stage)
    } else if (input.stage !== undefined && input.stage !== task.stage) {
      taskStore.updateStatus(input.taskId, task.status, stage)
    }
    taskStore.updateAgentReportStatus(input.taskId, input.agentStatus)

    const eventType =
      input.agentStatus === 'milestone'
        ? 'milestone'
        : input.agentStatus === 'blocked'
          ? 'input_requested'
          : 'marked_done'
    taskEventStore.append(input.taskId, {
      type: eventType,
      payload: {
        report_md: input.reportMd ?? null,
        agent_status: input.agentStatus,
        stage,
        from_status: previousStatus,
        to_status: nextStatus,
        recovered: nextStatus !== previousStatus,
      },
    })

    const updated = taskStore.get(input.taskId)
    const lifecycleChange =
      input.agentStatus === 'milestone'
        ? 'milestone'
        : input.agentStatus === 'blocked'
          ? 'input_requested'
          : 'marked_done'
    log.info(
      { taskId: input.taskId, agentStatus: input.agentStatus, from: previousStatus, to: nextStatus },
      'Agent 汇报',
    )
    if (updated) {
      events.emit('task:update', { taskId: input.taskId, data: { ...updated, event: 'reported' } })
      emitTaskLifecycleEvent(updated, lifecycleChange, previousStatus)
    }

    return updated
  },

  async replyTask(input: { taskId: string; message: string }) {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`Task 不存在: ${input.taskId}`)
    if (task.status !== 'needs_input') throw new Error('当前任务不在待确认状态，无法回复')
    if (!input.message?.trim()) throw new Error('回复内容不能为空')

    const sessionIds = taskStore.listSessionIds(input.taskId)
    const sessionId = sessionIds.length > 0 ? sessionIds[sessionIds.length - 1] : null
    if (!task.assigned_agent_id || !sessionId) {
      throw new Error('任务未关联 Agent 会话，无法回复')
    }

    const previousStatus = task.status
    taskStore.updateStatus(input.taskId, 'running', '人工已回复，继续执行')
    taskStore.updateAgentReportStatus(input.taskId, 'in_progress')
    taskEventStore.append(input.taskId, {
      type: 'replied',
      payload: {
        message: input.message,
        from_status: previousStatus,
        to_status: 'running',
      },
    })

    const updated = taskStore.get(input.taskId)
    log.info({ taskId: input.taskId, sessionId }, '人工回复任务')
    if (updated) {
      events.emit('task:update', { taskId: input.taskId, data: { ...updated, event: 'replied' } })
      emitTaskLifecycleEvent(updated, 'replied', previousStatus)
    }

    const prompt = `[人工回复] ${input.message}\n\n请继续执行任务。`
    sessionManager.enqueuePrompt(sessionId, prompt).catch((err: Error) => {
      log.error({ err, taskId: input.taskId, sessionId }, '人工回复 prompt 发送失败')
    })

    return updated
  },
}

export { emitTaskLifecycleEvent } from './task-lifecycle-events.js'
export { buildTaskPrompt } from './task-prompt.js'

export function resolveSessionMode(mode: unknown, sessionId?: string): AgentSessionMode {
  if (mode === 'existing' || mode === 'new_each' || mode === 'new_fixed') return mode
  return sessionId ? 'existing' : 'new_each'
}

export function validateSessionModeTarget(mode: AgentSessionMode, sessionId?: string): void {
  if (mode === 'existing' && !sessionId) throw new Error('existing session mode requires sessionId')
}

export async function resolveTaskSession(input: {
  agentId: string
  projectId?: string | null
  taskId?: string
  sessionId?: string
  sessionMode?: AgentSessionMode
}): Promise<{ id: string; reuse: boolean }> {
  const mode = input.sessionMode ?? resolveSessionMode(undefined, input.sessionId)
  validateSessionModeTarget(mode, input.sessionId)
  if (mode === 'existing') {
    const sessionId = input.sessionId
    if (!sessionId) throw new Error('existing session mode requires sessionId')
    validateTaskAssignment(input.agentId, input.projectId, sessionId)
    return { id: sessionId, reuse: true }
  }
  if (mode === 'new_fixed' && input.sessionId) {
    validateTaskAssignment(input.agentId, input.projectId, input.sessionId)
    return { id: input.sessionId, reuse: true }
  }
  const session = await sessionManager.createSession(input.agentId, input.taskId, input.projectId ?? undefined)
  return { id: session.id, reuse: false }
}

export function validateTaskAssignment(
  agentId: string | undefined,
  projectId: string | null | undefined,
  sessionId?: string,
): void {
  validateAssignedAgentProject(agentId, projectId ?? undefined)
  if (!agentId || !sessionId) return
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`会话不存在: ${sessionId}`)
  if (session.agent_id !== agentId) throw new Error('会话不属于被指派 Agent')
  if (projectId && session.project_id !== projectId) throw new Error('会话不属于当前项目')
}

function validateAssignedAgentProject(agentId: string | undefined, projectId: string | undefined): void {
  if (!agentId) return
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  if (projectId && agent.project_id !== projectId)
    throw new Error(`Project mismatch: Agent ${agentId} is outside current project`)
}

function toStoredImageAttachments(rows: TaskAttachmentRow[]): StoredImageAttachment[] {
  return rows.map((row) => ({
    mimeType: row.mime_type,
    name: row.name ?? undefined,
    relativePath: row.relative_path,
    path: row.absolute_path,
    url: row.url,
    size: row.size,
    order: row.sort_order,
  }))
}
