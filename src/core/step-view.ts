import { taskStepStore, getStepReports, type TaskStepRow } from '../store/task-steps.js'
import type { StepArtifact } from './task-steps.js'

export interface StepView {
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

export function buildStepView(taskId: string, stepId: string): StepView | null {
  const step = taskStepStore.get(stepId)
  if (!step || step.task_id !== taskId) return null
  return {
    id: step.id,
    title: step.title,
    description: step.description,
    status: step.status,
    assignee: step.assignee_agent_id,
    sessionId: step.session_id,
    dependsOn: taskStepStore.listDependencies(stepId),
    currentStage: step.current_stage,
    reports: collectReports(taskId, stepId),
  }
}

function collectReports(taskId: string, stepId: string): StepView['reports'] {
  return getStepReports(taskId, stepId).map((row) => {
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

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export type { StepArtifact, TaskStepRow }
