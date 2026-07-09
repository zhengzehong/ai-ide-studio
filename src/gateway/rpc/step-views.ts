import { taskStepStore, getStepReports } from '../../store/task-steps.js'
import type { StepReportRow } from '../../store/task-steps.js'
import type { StepArtifact } from '../../core/task-steps.js'

export interface StepViewRpc {
  id: string
  title: string
  description: string | null
  status: string
  assignee: string | null
  sessionId: string | null
  dependsOn: string[]
  currentStage: string | null
  reports: Array<{
    agentStatus: string
    reportMd: string | null
    artifacts?: StepArtifact[]
    agentId: string
    sessionId: string
    time: string
  }>
}

export interface StepSummaryRpc {
  id: string
  title: string
  status: string
  assignee: string | null
  sessionId: string | null
  dependsOn: string[]
  currentStage: string | null
}

export interface StepProgressRpc {
  done: number
  total: number
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function collectReports(taskId: string, stepId: string): StepViewRpc['reports'] {
  return getStepReports(taskId, stepId).map((row: StepReportRow) => {
    const payload = parsePayload(row.payload_json)
    return {
      agentStatus: typeof payload.agentStatus === 'string' ? payload.agentStatus : '',
      reportMd: typeof payload.reportMd === 'string' ? payload.reportMd : null,
      artifacts: Array.isArray(payload.artifacts) ? (payload.artifacts as StepArtifact[]) : undefined,
      agentId: typeof payload.agentId === 'string' ? payload.agentId : '',
      sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : '',
      time: row.created_at,
    }
  })
}

export function buildStepSummary(taskId: string, stepId: string): StepSummaryRpc {
  const step = taskStepStore.get(stepId)
  if (!step || step.task_id !== taskId) {
    throw new Error(`步骤不存在: ${stepId}`)
  }
  return {
    id: step.id,
    title: step.title,
    status: step.status,
    assignee: step.assignee_agent_id,
    sessionId: step.session_id,
    dependsOn: taskStepStore.listDependencies(stepId),
    currentStage: step.current_stage,
  }
}

export function buildStepViewRpc(taskId: string, stepId: string): StepViewRpc {
  const step = taskStepStore.get(stepId)
  if (!step || step.task_id !== taskId) {
    throw new Error(`步骤不存在: ${stepId}`)
  }
  return {
    ...buildStepSummary(taskId, stepId),
    description: step.description,
    reports: collectReports(taskId, stepId),
  }
}

export function buildTaskStepList(taskId: string): StepSummaryRpc[] {
  return taskStepStore.listByTask(taskId).map(s => buildStepSummary(taskId, s.id))
}

export function buildStepProgress(taskId: string): StepProgressRpc {
  const steps = taskStepStore.listByTask(taskId)
  const done = steps.filter(s => s.status === 'done').length
  return { done, total: steps.length }
}
