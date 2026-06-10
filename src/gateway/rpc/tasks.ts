import { taskManager, buildTaskPrompt } from '../../core/tasks.js'
import { taskStore } from '../../store/tasks.js'
import { sessionStore } from '../../store/sessions.js'
import { events } from '../../core/events.js'
import type { RpcHandlerMap } from './types.js'

export const taskRpcHandlers: RpcHandlerMap = {
  'tasks.list'(msg, { sendResult }) {
    const tasks = taskStore.list(msg.status as string | undefined, msg.projectId as string | undefined)
    const tasksWithSession = tasks.map(t => {
      const sessions = sessionStore.listByTask(t.id)
      return { ...t, sessionId: sessions.length > 0 ? sessions[sessions.length - 1].id : null }
    })
    sendResult(tasksWithSession)
  },

  'tasks.get'(msg, { sendResult, sendError }) {
    const task = taskStore.get(msg.taskId as string)
    if (!task) return sendError('任务不存在')
    const sessions = sessionStore.listByTask(task.id).map(s => ({ id: s.id, agentId: s.agent_id, status: s.status, startedAt: s.started_at }))
    sendResult({ ...task, sessions })
  },

  async 'tasks.create'(msg, { sendResult }) {
    const task = await taskManager.createTask({
      title: msg.title as string,
      description: msg.description as string | undefined,
      assignAgentId: msg.assignAgentId as string | undefined,
      projectId: msg.projectId as string | undefined,
      sessionId: msg.sessionId as string | undefined,
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
      updated = taskManager.updateTask(taskId, msg.status as string | undefined, msg.stage as string | undefined)
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

    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    if (!agentId) return sendError('agentId 不能为空')

    taskStore.assignAgent(taskId, agentId)

    const { sessionManager } = await import('../../core/sessions.js')

    try {
      const session = sessionId
        ? { id: sessionId }
        : await sessionManager.createSession(agentId, taskId, task.project_id ?? undefined)

      taskStore.updateStatus(taskId, 'executing', '已分派给 Agent')
      events.emit('task:update', {
        taskId,
        data: { ...taskStore.get(taskId), sessionId: session.id, assignedAgentId: agentId, event: 'assigned' },
      })

      const prompt = buildTaskPrompt(
        { id: task.id, title: task.title, description: task.description, source: task.source },
        { sessionReuse: !!sessionId },
      )
      sessionManager.sendPrompt(session.id, prompt).catch((err: Error) => {
        taskStore.updateStatus(taskId, 'blocked', `指派 prompt 发送失败: ${err.message}`)
        events.emit('task:update', { taskId, data: { ...taskStore.get(taskId), event: 'prompt_failed' } })
      })

      sendResult({ ...taskStore.get(taskId), sessionId: session.id })
    } catch (err) {
      taskStore.updateStatus(taskId, 'blocked', `指派失败: ${(err as Error).message}`)
      events.emit('task:update', { taskId, data: { ...taskStore.get(taskId), event: 'assign_failed' } })
      sendError(`指派失败: ${(err as Error).message}`)
    }
  },
}
