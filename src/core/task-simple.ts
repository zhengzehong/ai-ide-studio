import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { taskStepManager } from './task-steps.js'
import { emitTaskLifecycleEvent, validateTaskAssignment } from './tasks.js'
import { taskStore, type TaskRow } from '../store/tasks.js'
import { taskStepStore } from '../store/task-steps.js'

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
  const dispatched = await taskStepManager.dispatchStep(task.id, step.id)
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
