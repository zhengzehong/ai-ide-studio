import { agentSessionCommunicationService } from './agent-session-communication.js'
import type { TaskRow } from '../store/tasks.js'
import type { TaskStepRow } from '../store/task-steps.js'

export type TaskWatchTrigger = 'step_done' | 'step_blocked' | 'task_completed' | 'task_reverted'

export function triggerTaskWatch(
  trigger: TaskWatchTrigger,
  taskId: string,
  task: TaskRow,
  stepId?: string,
  step?: TaskStepRow,
): void {
  agentSessionCommunicationService.triggerTaskWatchFromTask({
    taskId,
    trigger,
    taskTitle: task.title,
    taskStatus: task.status,
    stepId,
    stepTitle: step?.title,
    stepStatus: step?.status,
  })
}
