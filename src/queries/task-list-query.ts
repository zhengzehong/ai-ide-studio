import type { TaskListItem, TaskStepSummary } from '../ports/query-port.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { taskStepStore, type TaskStepRow } from '../store/task-steps.js'
import {
  extractReportPreview,
  taskEventStore,
  taskStore,
  type TaskEventRow,
} from '../store/tasks.js'

export function listTaskReadModel(input: { status?: string; projectId?: string }): TaskListItem[] {
  const tasks = taskStore.list(input.status, input.projectId)
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
    const taskSteps = stepsByTask.get(task.id) ?? []
    const sessionIds = sessionsByTask.get(task.id) ?? []
    return {
      ...task,
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
