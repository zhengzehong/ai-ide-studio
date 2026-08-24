import { taskStore } from '../store/tasks.js'
import { taskStepStore } from '../store/task-steps.js'
import type { PromptIntent, PromptIntentValidation, PromptIntentValidator } from './prompt-intent.js'

export const taskStepIntentValidator = {
  validate(intent: PromptIntent): PromptIntentValidation {
    if (intent.source !== 'task-step') return { valid: true }
    if (!intent.taskId || !intent.stepId || !intent.sessionId) {
      return { valid: false, reason: 'task-step intent is missing identity' }
    }

    const task = taskStore.get(intent.taskId)
    if (!task) return { valid: false, reason: 'task-not-found' }
    if (task.status === 'completed' || task.status === 'cancelled') {
      return { valid: false, reason: `task-${task.status}` }
    }

    const step = taskStepStore.get(intent.stepId)
    if (!step || step.task_id !== task.id) return { valid: false, reason: 'step-not-found' }
    if (step.session_id !== intent.sessionId) return { valid: false, reason: 'step-session-mismatch' }
    if (step.status !== 'running') return { valid: false, reason: `step-${step.status}` }
    return { valid: true }
  },
} satisfies PromptIntentValidator

export async function validatePromptIntent(intent: PromptIntent | undefined): Promise<PromptIntentValidation> {
  if (!intent || intent.source !== 'task-step') return { valid: true }
  return taskStepIntentValidator.validate(intent)
}
