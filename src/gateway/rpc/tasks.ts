import { taskManager, resolveSessionMode, validateSessionModeTarget, validateTaskAssignment } from '../../core/tasks.js'
import { taskStore, taskEventStore } from '../../store/tasks.js'
import { taskExecutionModeStore } from '../../store/task-execution-modes.js'
import { sessionStore, type SessionRow } from '../../store/sessions.js'
import { events } from '../../core/events.js'
import type { RpcHandlerMap } from './types.js'
import type { ImageAttachment } from '../../types/ws-protocol.js'

export const taskRpcHandlers: RpcHandlerMap = {
  'tasks.list'(msg, { sendResult }) {
    const tasks = taskStore.list(msg.status as string | undefined, msg.projectId as string | undefined)
    const tasksWithSession = tasks.map(t => {
      const sessions = listTaskSessions(t.id)
      return { ...t, sessionId: sessions.length > 0 ? sessions[sessions.length - 1].id : null }
    })
    sendResult(tasksWithSession)
  },

  'tasks.get'(msg, { sendResult, sendError }) {
    const task = taskStore.get(msg.taskId as string)
    if (!task) return sendError('任务不存在')
    const sessions = listTaskSessions(task.id).map(s => ({ id: s.id, agentId: s.agent_id, status: s.status, startedAt: s.started_at }))
    sendResult({ ...task, sessions })
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
