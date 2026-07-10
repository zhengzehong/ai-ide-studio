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
  assignee: string
  sessionId?: string
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
  const assignee = input.assignee.trim()
  if (!title) throw new Error('title 不能为空')
  if (!description) throw new Error('description 不能为空')
  if (!assignee) throw new Error('assignee 不能为空')

  validateTaskAssignment(assignee, input.projectId, input.sessionId)

  const task = taskStore.create({
    title,
    description,
    source: input.source ?? 'human',
    projectId: input.projectId,
  })
  events.emit('task:update', { taskId: task.id, data: { ...task, event: 'created' } })
  emitTaskLifecycleEvent(task, 'created', null)

  const { step } = taskStepManager.addStep({
    taskId: task.id,
    title,
    description,
    assignee,
    sessionId: input.sessionId,
  })
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
