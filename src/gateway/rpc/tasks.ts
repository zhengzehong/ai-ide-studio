import { taskManager, buildTaskPrompt, resolveSessionMode, resolveTaskSession, validateSessionModeTarget, validateTaskAssignment } from '../../core/tasks.js'
import { taskStore } from '../../store/tasks.js'
import { sessionStore, type SessionRow } from '../../store/sessions.js'
import { events } from '../../core/events.js'
import type { RpcHandlerMap } from './types.js'

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
    const { sessionManager } = await import('../../core/sessions.js')

    try {
      taskStore.assignAgent(taskId, agentId)
      const session = await resolveTaskSession({
        agentId,
        projectId: task.project_id,
        taskId,
        sessionId,
        sessionMode,
      })

      taskStore.updateStatus(taskId, 'executing', '已分派给 Agent')
      taskStore.linkSession(taskId, session.id)
      events.emit('task:update', {
        taskId,
        data: { ...taskStore.get(taskId), sessionId: session.id, assignedAgentId: agentId, event: 'assigned' },
      })

      const prompt = buildTaskPrompt(
        { id: task.id, title: task.title, description: task.description, source: task.source },
        { sessionReuse: session.reuse },
      )
      sessionManager.enqueuePrompt(session.id, prompt).catch((err: Error) => {
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
