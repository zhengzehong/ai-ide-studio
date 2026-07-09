import { getDb } from './db.js'

export interface TaskStepRow {
  id: string
  task_id: string
  title: string
  description: string | null
  status: string
  assignee_agent_id: string | null
  session_id: string | null
  current_stage: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TaskStepDependencyRow {
  step_id: string
  depends_on_step_id: string
  task_id: string
  created_at: string
}

export interface StepReportRow {
  id: string
  task_id: string
  type: string
  payload_json: string
  sequence: number
  created_at: string
}

export const taskStepStore = {
  listByTask(taskId: string): TaskStepRow[] {
    return getDb()
      .prepare<[string], TaskStepRow>(
        'SELECT * FROM task_steps WHERE task_id = ? ORDER BY sort_order ASC, created_at ASC',
      )
      .all(taskId)
  },

  get(stepId: string): TaskStepRow | undefined {
    return getDb().prepare<[string], TaskStepRow>('SELECT * FROM task_steps WHERE id = ?').get(stepId)
  },

  listDependencies(stepId: string): string[] {
    return getDb()
      .prepare<[string], { depends_on_step_id: string }>(
        'SELECT depends_on_step_id FROM task_step_dependencies WHERE step_id = ?',
      )
      .all(stepId)
      .map(row => row.depends_on_step_id)
  },

  listDependents(stepId: string): string[] {
    return getDb()
      .prepare<[string], { step_id: string }>(
        'SELECT step_id FROM task_step_dependencies WHERE depends_on_step_id = ?',
      )
      .all(stepId)
      .map(row => row.step_id)
  },

  listAssignedAgents(taskId: string): string[] {
    return getDb()
      .prepare<
        [string],
        { assignee_agent_id: string }
      >(
        `SELECT DISTINCT assignee_agent_id FROM task_steps
         WHERE task_id = ? AND assignee_agent_id IS NOT NULL
         ORDER BY assignee_agent_id ASC`,
      )
      .all(taskId)
      .map(row => row.assignee_agent_id)
  },

  listReadyCandidates(taskId: string): TaskStepRow[] {
    return getDb()
      .prepare<[string], TaskStepRow>(
        `SELECT s.* FROM task_steps s
         WHERE s.task_id = ?
           AND s.status = 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM task_step_dependencies d
             WHERE d.step_id = s.id
               AND NOT EXISTS (
                 SELECT 1 FROM task_steps s2
                 WHERE s2.id = d.depends_on_step_id AND s2.status = 'done'
               )
           )
         ORDER BY s.sort_order ASC, s.created_at ASC`,
      )
      .all(taskId)
  },

  listStepReports(taskId: string, stepId: string): StepReportRow[] {
    return getDb()
      .prepare<
        [string, string],
        StepReportRow
      >(
        `SELECT id, task_id, type, payload_json, sequence, created_at
         FROM task_events
         WHERE task_id = ?
           AND type = 'step_report'
           AND json_extract(payload_json, '$.stepId') = ?
         ORDER BY sequence ASC`,
      )
      .all(taskId, stepId)
  },
}

export function getTaskSteps(taskId: string): TaskStepRow[] {
  return taskStepStore.listByTask(taskId)
}

export function getStepDependencies(stepId: string): string[] {
  return taskStepStore.listDependencies(stepId)
}

export function getDependents(stepId: string): string[] {
  return taskStepStore.listDependents(stepId)
}

export function getStepReports(taskId: string, stepId: string): StepReportRow[] {
  return taskStepStore.listStepReports(taskId, stepId)
}

export function getTaskAssignedAgents(taskId: string): string[] {
  return taskStepStore.listAssignedAgents(taskId)
}

export function getReadySteps(taskId: string): TaskStepRow[] {
  return taskStepStore.listReadyCandidates(taskId)
}
