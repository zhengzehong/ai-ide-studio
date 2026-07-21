import type { TaskData } from '../../../stores/task.store'

export function resolveTaskDetail(
  summary: TaskData,
  detail: TaskData | undefined,
): TaskData | null {
  if (!detail) return null
  return {
    ...detail,
    ...summary,
    description: detail.description,
  }
}
