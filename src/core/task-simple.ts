import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { taskStepManager } from './task-steps.js'
import { emitTaskLifecycleEvent, validateTaskAssignment } from './tasks.js'
import { taskStore, type TaskRow } from '../store/tasks.js'
import { taskStepStore } from '../store/task-steps.js'
import { sessionManager } from './sessions.js'

const log = createChildLogger('task-simple')

export interface CreateSimpleTaskInput {
  title: string
  description: string
  selfExecute?: boolean
  assignee?: string
  sessionId?: string
  currentAgentId?: string
  currentSessionId?: string
  projectId?: string
  source?: string
}

export interface CreateSimpleTaskResult {
  task: TaskRow
  defaultStepId: string
  sessionId: string
}

export async function createSimpleTask(input: CreateSimpleTaskInput): Promise<CreateSimpleTaskResult> {
  const title = input.title.trim()
  const description = input.description.trim()
  if (!title) throw new Error('title 不能为空')
  if (!description) throw new Error('description 不能为空')
  const selfExecute = input.selfExecute === true
  const assignee = selfExecute ? input.currentAgentId?.trim() : input.assignee?.trim()
  const sessionId = selfExecute ? input.currentSessionId?.trim() : input.sessionId
  if (selfExecute && !input.currentAgentId?.trim()) throw new Error('selfExecute=true 需要当前 Agent')
  if (selfExecute && !input.currentSessionId?.trim()) throw new Error('selfExecute=true 需要当前会话')
  if (!assignee) throw new Error('assignee 不能为空')

  validateTaskAssignment(assignee, input.projectId, sessionId)

  const task = taskStore.create({
    title,
    description,
    source: input.source ?? 'human',
    projectId: input.projectId,
    initiatorAgentId: input.currentAgentId?.trim() || null,
    initiatorSessionId: input.currentSessionId?.trim() || null,
  })
  events.emit('task:update', { taskId: task.id, data: { ...task, event: 'created' } })
  emitTaskLifecycleEvent(task, 'created', null)

  const { step } = taskStepManager.addStep({
    taskId: task.id,
    title,
    description,
    assignee,
    sessionId,
  })

  if (selfExecute) {
    taskStore.assignAgent(task.id, assignee)
    taskStepStore.updateStatus(step.id, 'running')
    taskStore.updateStatus(task.id, 'running', '已自认领')
    taskStore.linkSession(task.id, sessionId!)
    taskStore.updateAgentReportStatus(task.id, 'in_progress')
    const updated = taskStore.get(task.id)
    if (!updated) throw new Error('任务自认领后无法找到任务')

    events.emit('task:update', {
      taskId: task.id,
      data: {
        ...updated,
        event: 'self_claimed',
        defaultStepId: step.id,
        sessionId,
        assignedAgentId: assignee,
      },
    })
    emitTaskLifecycleEvent(updated, 'self_claimed', task.status)
    log.info({ taskId: task.id, stepId: step.id, sessionId }, '自认领任务已创建默认 step,跳过 prompt 注入')
    return { task: updated, defaultStepId: step.id, sessionId: sessionId! }
  }

  taskStore.updateStatus(task.id, 'running', '简单任务已启动')
  taskStepStore.updateStatus(step.id, 'ready')
  let dispatched: { stepId: string; sessionId: string; reused: boolean }
  try {
    dispatched = await taskStepManager.dispatchStep(task.id, step.id)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const failedTask = taskStore.get(task.id)
    if (failedTask) {
      taskStore.updateStatus(task.id, 'needs_input', `派发失败: ${errMsg}`)
      notifyInitiatorOnDispatchFailure(task.id, failedTask, errMsg)
    }
    const failedUpdated = taskStore.get(task.id)
    if (failedUpdated) {
      events.emit('task:update', {
        taskId: task.id,
        data: {
          ...failedUpdated,
          event: 'step_dispatch_failed',
          defaultStepId: step.id,
        },
      })
    }
    log.warn({ err, taskId: task.id, stepId: step.id }, '简单任务派发失败,task 已回退到 needs_input')
    throw err
  }
  const updated = taskStore.get(task.id)
  if (!updated) throw new Error('简单任务创建后无法找到任务')

  events.emit('task:update', {
    taskId: task.id,
    data: {
      ...updated,
      event: 'simple_created',
      defaultStepId: step.id,
      sessionId: dispatched.sessionId,
    },
  })
  log.info({ taskId: task.id, stepId: step.id, assignee, sessionId: dispatched.sessionId }, '简单任务已创建并派发')

  return { task: updated, defaultStepId: step.id, sessionId: dispatched.sessionId }
}

function notifyInitiatorOnDispatchFailure(taskId: string, task: TaskRow, message: string): void {
  if (!task.initiator_agent_id || !task.initiator_session_id) return
  const notice = `[派发失败] 任务 ${task.title} 的步骤派发失败:${message}。请处理。`
  sessionManager.enqueuePrompt(task.initiator_session_id, notice).catch((err: Error) => {
    log.warn(
      { err, taskId, initiatorSessionId: task.initiator_session_id },
      'failed to notify initiator on createSimple dispatch failure',
    )
  })
}
