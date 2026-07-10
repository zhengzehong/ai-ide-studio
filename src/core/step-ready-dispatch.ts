import { taskStore } from '../store/tasks.js'
import { taskStepStore } from '../store/task-steps.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { dispatchStep } from './step-dispatch.js'
import { emitTaskLifecycleEvent } from './task-lifecycle-events.js'

const log = createChildLogger('step-ready-dispatch')

export interface DispatchReadyStepsResult {
  dispatchedSteps: string[]
  failedStepId?: string
  failureMessage?: string
}

export async function dispatchReadySteps(taskId: string, stepIds: string[]): Promise<DispatchReadyStepsResult> {
  const dispatchedSteps: string[] = []
  for (const stepId of stepIds) {
    const task = taskStore.get(taskId)
    if (!task || task.status !== 'running') break
    const step = taskStepStore.get(stepId)
    if (!step || step.task_id !== taskId || step.status !== 'ready' || !step.assignee_agent_id) continue
    try {
      await dispatchStep(taskId, stepId)
      dispatchedSteps.push(stepId)
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : String(err)
      markStepDispatchFailed(taskId, stepId, err, failureMessage)
      return { dispatchedSteps, failedStepId: stepId, failureMessage }
    }
  }
  return { dispatchedSteps }
}

function markStepDispatchFailed(taskId: string, stepId: string, err: unknown, message: string): void {
  const previous = taskStore.get(taskId)
  if (!previous) return
  taskStore.updateStatus(taskId, 'needs_input', `步骤派发失败: ${message}`)
  const updated = taskStore.get(taskId)
  if (!updated) return
  log.warn({ err, taskId, stepId }, 'failed to dispatch ready step')
  events.emit('task:update', {
    taskId,
    data: { ...updated, event: 'step_dispatch_failed', failedStepId: stepId },
  })
  emitTaskLifecycleEvent(updated, 'prompt_failed', previous.status)
}
