import { eventCenterService } from './event-center.js'
import { createChildLogger } from './logger.js'
import type { TaskRow } from '../store/tasks.js'

const log = createChildLogger('task-lifecycle')

export function resolveTaskLifecycleChangeType(previous: TaskRow, updated: TaskRow): string {
  if (updated.status !== previous.status) return 'status_changed'
  if (updated.assigned_agent_id !== previous.assigned_agent_id || updated.assignee_member_id !== previous.assignee_member_id)
    return 'assigned'
  return 'progress_updated'
}

export function emitTaskLifecycleEvent(task: TaskRow, changeType: string, previousStatus?: string | null): void {
  try {
    eventCenterService.createEvent({
      projectId: task.project_id ?? undefined,
      categoryId: 'task.lifecycle',
      title: `任务变更：${task.title}`,
      summary: task.stage || `任务状态：${task.status}`,
      sourceType: 'task',
      sourceId: task.id,
      sourceLabel: task.title,
      priority: task.status === 'needs_input' ? 'high' : 'medium',
      payload: {
        taskId: task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        previousStatus: previousStatus ?? null,
        assignedAgentId: task.assigned_agent_id,
        changeType,
        stage: task.stage,
        source: task.source,
      },
    })
  } catch (err) {
    log.warn({ err, taskId: task.id, changeType }, 'Failed to write task lifecycle event')
  }
}
