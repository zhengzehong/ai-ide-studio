import type { TaskListItem, TaskPage, TaskPageQuery, TaskStepSummary } from '../ports/query-port.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { taskStepStore, type TaskStepRow } from '../store/task-steps.js'
import {
  extractReportPreview,
  taskEventStore,
  taskStore,
  type TaskEventRow,
  type TaskRow,
} from '../store/tasks.js'
import { listTaskPageRows } from '../store/task-page.js'

const DEFAULT_TASK_PAGE_LIMIT = 50
const MAX_TASK_PAGE_LIMIT = 200

export function listTaskReadModel(input: { status?: string; projectId?: string }): TaskListItem[] {
  const tasks = taskStore.list(input.status, input.projectId)
  return enrichTaskRows(tasks)
}

export function listTaskPageReadModel(input: TaskPageQuery): TaskPage {
  const limit = boundedLimit(input.limit, DEFAULT_TASK_PAGE_LIMIT, MAX_TASK_PAGE_LIMIT)
  const page = listTaskPageRows({ ...input, limit })
  const hasMore = page.items.length > limit
  const rows = hasMore ? page.items.slice(0, limit) : page.items
  return {
    items: enrichTaskRows(rows),
    total: page.total,
    hasMore,
    nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
  }
}

function enrichTaskRows(tasks: TaskRow[]): TaskListItem[] {
  if (tasks.length === 0) return []

  const taskIds = tasks.map((task) => task.id)
  const latestReports = taskEventStore.listLatestByTaskIds(taskIds)
  const steps = taskStepStore.listByTaskIds(taskIds)
  const dependencies = taskStepStore.listDependenciesByStepIds(steps.map((step) => step.id))
  const directSessions = sessionStore.listByTaskIds(taskIds)
  const linkedSessions = taskEventStore.listLinkedSessionsByTaskIds(taskIds)
  const linkedSessionIds = Array.from(new Set(linkedSessions.map((link) => link.sessionId)))
  const existingLinkedSessionIds = new Set(sessionStore.listByIds(linkedSessionIds).map((session) => session.id))

  const dependenciesByStep = new Map<string, string[]>()
  for (const dependency of dependencies) {
    const current = dependenciesByStep.get(dependency.step_id) ?? []
    current.push(dependency.depends_on_step_id)
    dependenciesByStep.set(dependency.step_id, current)
  }

  const stepsByTask = groupByTask(steps)
  const sessionsByTask = groupSessionsByTask(directSessions)
  for (const link of linkedSessions) {
    if (!existingLinkedSessionIds.has(link.sessionId)) continue
    const current = sessionsByTask.get(link.taskId) ?? []
    if (!current.includes(link.sessionId)) current.push(link.sessionId)
    sessionsByTask.set(link.taskId, current)
  }

  return tasks.map((task) => {
    const { description, ...taskSummary } = task
    const taskSteps = stepsByTask.get(task.id) ?? []
    const sessionIds = sessionsByTask.get(task.id) ?? []
    return {
      ...taskSummary,
      descriptionPreview: taskDescriptionPreview(description),
      sessionId: sessionIds.at(-1) ?? null,
      steps: taskSteps.map((step) => toStepSummary(step, dependenciesByStep)),
      stepProgress: {
        done: taskSteps.filter((step) => step.status === 'done').length,
        total: taskSteps.length,
      },
      ...latestReportSummary(latestReports[task.id]),
    }
  })
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(1, Math.floor(value)))
}

export function taskDescriptionPreview(value: string | null): string | null {
  if (!value) return null
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`
}

function groupByTask(steps: TaskStepRow[]): Map<string, TaskStepRow[]> {
  const result = new Map<string, TaskStepRow[]>()
  for (const step of steps) {
    const current = result.get(step.task_id) ?? []
    current.push(step)
    result.set(step.task_id, current)
  }
  return result
}

function groupSessionsByTask(sessions: SessionRow[]): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.task_id) continue
    const current = result.get(session.task_id) ?? []
    current.push(session.id)
    result.set(session.task_id, current)
  }
  return result
}

function toStepSummary(
  step: TaskStepRow,
  dependenciesByStep: Map<string, string[]>,
): TaskStepSummary {
  return {
    id: step.id,
    title: step.title,
    status: step.status,
    assignee: step.assignee_agent_id,
    sessionId: step.session_id,
    dependsOn: dependenciesByStep.get(step.id) ?? [],
    currentStage: step.current_stage,
  }
}

function latestReportSummary(event?: TaskEventRow): Pick<
  TaskListItem,
  'latestReportPreview' | 'latestReportAt' | 'latestReportType'
> {
  if (!event) {
    return { latestReportPreview: null, latestReportAt: null, latestReportType: null }
  }
  return {
    latestReportPreview: extractReportPreview(event.payload_json),
    latestReportAt: event.created_at,
    latestReportType: event.type,
  }
}
