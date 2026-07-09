import { taskManager, resolveSessionMode, validateSessionModeTarget, validateTaskAssignment } from '../../core/tasks.js'
import { taskStore, taskEventStore, extractReportPreview } from '../../store/tasks.js'
import { taskExecutionModeStore } from '../../store/task-execution-modes.js'
import { sessionStore, type SessionRow } from '../../store/sessions.js'
import { events } from '../../core/events.js'
import { taskStepManager, type StepArtifact } from '../../core/task-steps.js'
import type { RpcHandlerMap } from './types.js'
import type { ImageAttachment } from '../../types/ws-protocol.js'
import { buildStepProgress, buildStepSummary, buildStepViewRpc, buildTaskStepList } from './step-views.js'

interface TaskLatestReportSummary {
  latestReportPreview: string | null
  latestReportAt: string | null
  latestReportType: string | null
}

function buildLatestReportSummary(taskId: string, latestByTask: Record<string, import('../../store/tasks.js').TaskEventRow>): TaskLatestReportSummary {
  const ev = latestByTask[taskId]
  if (!ev) {
    return { latestReportPreview: null, latestReportAt: null, latestReportType: null }
  }
  return {
    latestReportPreview: extractReportPreview(ev.payload_json),
    latestReportAt: ev.created_at,
    latestReportType: ev.type,
  }
}

export const taskRpcHandlers: RpcHandlerMap = {
  'tasks.list'(msg, { sendResult }) {
    const tasks = taskStore.list(msg.status as string | undefined, msg.projectId as string | undefined)
    const taskIds = tasks.map(t => t.id)
    const latestByTask = taskEventStore.listLatestByTaskIds(taskIds)
    const tasksWithSession = tasks.map(t => {
      const sessions = listTaskSessions(t.id)
      return {
        ...t,
        sessionId: sessions.length > 0 ? sessions[sessions.length - 1].id : null,
        steps: buildTaskStepList(t.id),
        stepProgress: buildStepProgress(t.id),
        ...buildLatestReportSummary(t.id, latestByTask),
      }
    })
    sendResult(tasksWithSession)
  },

  'tasks.get'(msg, { sendResult, sendError }) {
    const task = taskStore.get(msg.taskId as string)
    if (!task) return sendError('任务不存在')
    const sessions = listTaskSessions(task.id).map(s => ({ id: s.id, agentId: s.agent_id, status: s.status, startedAt: s.started_at }))
    sendResult({
      ...task,
      sessions,
      steps: buildTaskStepList(task.id),
      stepProgress: buildStepProgress(task.id),
    })
  },

  async 'tasks.create'(msg, { sendResult }) {
    const task = await taskManager.createTask({
      title: msg.title as string,
      description: msg.description as string | undefined,
      assignAgentId: msg.assignAgentId as string | undefined,
      projectId: msg.projectId as string | undefined,
      sessionId: msg.sessionId as string | undefined,
      sessionMode: resolveSessionMode(msg.sessionMode, msg.sessionId as string | undefined),
      images: msg.images as ImageAttachment[] | undefined,
      executionModeId: (msg.executionModeId as string | undefined) ?? undefined,
    })
    sendResult(task)
  },

  'tasks.update'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    if (!taskId) return sendError('taskId 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')

    let updated
    if (msg.title !== undefined || msg.description !== undefined) {
      taskStore.update(taskId, {
        title: msg.title as string | undefined,
        description: msg.description as string | undefined,
        status: msg.status as string | undefined,
        stage: msg.stage as string | undefined,
      })
      updated = taskStore.get(taskId)
      events.emit('task:update', { taskId, data: { ...updated, event: 'updated' } })
    } else {
      const reason = typeof msg.reason === 'string' ? msg.reason : undefined
      updated = taskManager.updateTask(taskId, msg.status as string | undefined, msg.stage as string | undefined, undefined, reason)
    }

    sendResult(updated)
  },

  'tasks.delete'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    taskStore.delete(taskId)
    events.emit('task:update', { taskId, data: { id: taskId, event: 'deleted' } })
    sendResult({ deleted: true, taskId })
  },

  async 'tasks.assign'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const agentId = msg.agentId as string
    const sessionId = msg.sessionId as string | undefined
    const sessionMode = resolveSessionMode(msg.sessionMode, sessionId)

    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    if (!agentId) return sendError('agentId 不能为空')

    validateSessionModeTarget(sessionMode, sessionId)
    validateTaskAssignment(
      agentId,
      task.project_id,
      sessionMode === 'existing' || (sessionMode === 'new_fixed' && sessionId) ? sessionId : undefined,
    )
    try {
      const assigned = await taskManager.assignTask({ taskId, agentId, sessionId, sessionMode })
      sendResult(assigned)
    } catch (err) {
      sendError(`指派失败: ${(err as Error).message}`)
    }
  },

  async 'tasks.reply'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const message = msg.message as string
    if (!taskId) return sendError('taskId 不能为空')
    if (!message || !message.trim()) return sendError('回复内容不能为空')
    try {
      const task = await taskManager.replyTask({ taskId, message })
      sendResult(task)
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.events.list'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    if (!taskId) return sendError('taskId 不能为空')
    const afterSequence = typeof msg.afterSequence === 'number' ? msg.afterSequence : undefined
    const events = taskEventStore.list(taskId, afterSequence != null ? { afterSequence } : undefined)
    sendResult(events)
  },

  async 'tasks.start'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    if (!taskId) return sendError('taskId 不能为空')
    try {
      const result = await taskStepManager.startTask(taskId)
      sendResult({
        taskId,
        status: result.task.status,
        dispatched: result.dispatched,
        steps: buildTaskStepList(taskId),
        stepProgress: buildStepProgress(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.list'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    if (!taskId) return sendError('taskId 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    sendResult({
      taskId,
      steps: buildTaskStepList(taskId),
      stepProgress: buildStepProgress(taskId),
    })
  },

  'tasks.step.add'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    if (!taskId) return sendError('taskId 不能为空')
    const title = (msg.title as string | undefined)?.trim()
    if (!title) return sendError('title 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    try {
      const result = taskStepManager.addStep({
        taskId,
        title,
        description: typeof msg.description === 'string' ? msg.description : undefined,
        assignee: typeof msg.assignee === 'string' ? msg.assignee : undefined,
        sessionId: typeof msg.sessionId === 'string' ? msg.sessionId : undefined,
        dependsOn: Array.isArray(msg.dependsOn) ? (msg.dependsOn as string[]).filter(Boolean) : undefined,
      })
      sendResult({
        taskId,
        step: buildStepSummary(taskId, result.step.id),
        reverted: result.reverted,
        taskStatus: taskStore.get(taskId)?.status,
        steps: buildTaskStepList(taskId),
        stepProgress: buildStepProgress(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.update'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    try {
      const result = taskStepManager.updateStep({
        taskId,
        stepId,
        title: typeof msg.title === 'string' ? msg.title : undefined,
        description: msg.description !== undefined ? (typeof msg.description === 'string' ? msg.description : null) : undefined,
        assignee: msg.assignee !== undefined ? (typeof msg.assignee === 'string' ? msg.assignee : null) : undefined,
        sessionId: msg.sessionId !== undefined ? (typeof msg.sessionId === 'string' ? msg.sessionId : null) : undefined,
        dependsOn: Array.isArray(msg.dependsOn) ? (msg.dependsOn as string[]) : undefined,
      })
      sendResult({
        taskId,
        step: buildStepSummary(taskId, result.step.id),
        reverted: result.reverted,
        taskStatus: taskStore.get(taskId)?.status,
        steps: buildTaskStepList(taskId),
        stepProgress: buildStepProgress(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.remove'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    try {
      const result = taskStepManager.removeStep({ taskId, stepId })
      sendResult({
        taskId,
        stepId,
        removed: true,
        reverted: result.reverted,
        cancelledSessionId: result.cancelledSessionId,
        taskStatus: taskStore.get(taskId)?.status,
        steps: buildTaskStepList(taskId),
        stepProgress: buildStepProgress(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.get'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    try {
      const view = buildStepViewRpc(taskId, stepId)
      sendResult(view)
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.updateProgress'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    const stage = msg.stage as string | undefined
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    if (!stage || !stage.trim()) return sendError('stage 不能为空')
    try {
      const updated = taskStepManager.updateProgress({ taskId, stepId, stage })
      sendResult({
        taskId,
        stepId,
        status: updated.status,
        stage: updated.current_stage,
        steps: buildTaskStepList(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  async 'tasks.step.report'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    const agentStatus = msg.agentStatus as string | undefined
    const reportMd = msg.reportMd as string | undefined
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    if (agentStatus !== 'milestone' && agentStatus !== 'blocked' && agentStatus !== 'done') {
      return sendError('agentStatus 必须是 milestone / blocked / done 之一')
    }
    if (!reportMd) return sendError('reportMd 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    const artifacts: StepArtifact[] | undefined = Array.isArray(msg.artifacts)
      ? (msg.artifacts as unknown[])
          .map(item => {
            if (!item || typeof item !== 'object') return null
            const obj = item as Record<string, unknown>
            const type = obj.type
            const val = obj.value
            if (typeof type !== 'string' || typeof val !== 'string') return null
            if (type !== 'commit' && type !== 'file' && type !== 'doc' && type !== 'url') return null
            return { type, value: val } as StepArtifact
          })
          .filter((v): v is StepArtifact => v !== null)
      : undefined
    try {
      const result = taskStepManager.reportStep({
        taskId,
        stepId,
        agentStatus,
        reportMd,
        artifacts,
      })
      sendResult({
        taskId,
        stepId,
        newStatus: result.newStatus,
        unlockedSteps: result.unlockedSteps,
        taskCompleted: result.taskCompleted,
        taskStatus: taskStore.get(taskId)?.status,
        steps: buildTaskStepList(taskId),
        stepProgress: buildStepProgress(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.events.get'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const eventId = msg.eventId as string
    if (!taskId) return sendError('taskId 不能为空')
    if (!eventId) return sendError('eventId 不能为空')
    const row = taskEventStore.getById(eventId)
    if (!row) return sendError('事件不存在')
    if (row.task_id !== taskId) return sendError('事件不存在')
    const parsed = parseEventPayload(row.payload_json)
    const reportMd = typeof parsed.report_md === 'string' ? parsed.report_md : null
    const agentStatus = typeof parsed.agent_status === 'string' ? parsed.agent_status : null
    sendResult({
      id: row.id,
      taskId: row.task_id,
      type: row.type,
      sequence: row.sequence,
      createdAt: row.created_at,
      reportMd,
      agentStatus,
    })
  },

  'tasks.modes.list'(msg, { sendResult }) {
    const projectId = (msg.projectId as string | undefined) ?? null
    const modes = taskExecutionModeStore.list(projectId)
    sendResult(modes)
  },

  'tasks.modes.create'(msg, { sendResult, sendError }) {
    const name = (msg.name as string | undefined)?.trim()
    if (!name) return sendError('名称不能为空')
    try {
      const mode = taskExecutionModeStore.create({
        name,
        description: typeof msg.description === 'string' ? msg.description : null,
        promptTemplate: typeof msg.promptTemplate === 'string' ? msg.promptTemplate : '',
        reportTemplate: typeof msg.reportTemplate === 'string' ? msg.reportTemplate : '',
        projectId: (msg.projectId as string | undefined) ?? null,
      })
      sendResult(mode)
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.modes.update'(msg, { sendResult, sendError }) {
    const id = msg.id as string
    if (!id) return sendError('id 不能为空')
    const existing = taskExecutionModeStore.get(id)
    if (!existing) return sendError('执行模式不存在')
    try {
      const updated = taskExecutionModeStore.update(id, {
        name: typeof msg.name === 'string' ? msg.name : undefined,
        description: msg.description === undefined ? undefined : msg.description === null ? null : String(msg.description),
        promptTemplate: typeof msg.promptTemplate === 'string' ? msg.promptTemplate : undefined,
        reportTemplate: typeof msg.reportTemplate === 'string' ? msg.reportTemplate : undefined,
        sortOrder: typeof msg.sortOrder === 'number' ? msg.sortOrder : undefined,
      })
      sendResult(updated)
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.modes.delete'(msg, { sendResult, sendError }) {
    const id = msg.id as string
    if (!id) return sendError('id 不能为空')
    try {
      taskExecutionModeStore.delete(id)
      sendResult({ deleted: true, id })
    } catch (err) {
      sendError((err as Error).message)
    }
  },
}

function listTaskSessions(taskId: string): SessionRow[] {
  const sessions = sessionStore.listByTask(taskId)
  const seen = new Set(sessions.map((session) => session.id))
  for (const sessionId of taskStore.listSessionIds(taskId)) {
    if (seen.has(sessionId)) continue
    const session = sessionStore.get(sessionId)
    if (!session) continue
    sessions.push(session)
    seen.add(session.id)
  }
  return sessions
}

function parseEventPayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
