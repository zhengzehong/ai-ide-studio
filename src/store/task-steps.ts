import { randomUUID } from 'crypto'
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

export interface CreateStepInput {
  taskId: string
  title: string
  description?: string
  assigneeAgentId?: string
  sessionId?: string
  dependsOn?: string[]
}

export interface UpdateStepInput {
  title?: string
  description?: string | null
  assigneeAgentId?: string | null
  sessionId?: string | null
  dependsOn?: string[]
}

export interface StepReportRecord {
  agentStatus: string
  reportMd: string | null
  artifacts?: Array<{ type: string; value: string }>
  agentId: string
  sessionId: string
  time: string
}

export const taskStepStore = {
  create(input: CreateStepInput): TaskStepRow {
    const db = getDb()
    const now = new Date().toISOString()
    const id = `step-${randomUUID().slice(0, 8)}`
    const maxOrder = db
      .prepare<{ task_id: string }, { max_order: number | null }>(
        'SELECT MAX(sort_order) AS max_order FROM task_steps WHERE task_id = @task_id',
      )
      .get({ task_id: input.taskId })
    const sortOrder = (maxOrder?.max_order ?? -1) + 1
    const step: TaskStepRow = {
      id,
      task_id: input.taskId,
      title: input.title,
      description: input.description ?? null,
      status: 'pending',
      assignee_agent_id: input.assigneeAgentId ?? null,
      session_id: input.sessionId ?? null,
      current_stage: null,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
    }
    const apply = db.transaction(() => {
      db.prepare(
        `INSERT INTO task_steps (
           id, task_id, title, description, status, assignee_agent_id, session_id,
           current_stage, sort_order, created_at, updated_at
         ) VALUES (
           @id, @task_id, @title, @description, @status, @assignee_agent_id, @session_id,
           @current_stage, @sort_order, @created_at, @updated_at
         )`,
      ).run(step)
      if (input.dependsOn && input.dependsOn.length > 0) {
        this.replaceDependencies(input.taskId, id, input.dependsOn)
      }
    })
    apply()
    return step
  },

  setSessionId(stepId: string, sessionId: string): void {
    const existing = this.get(stepId)
    if (!existing) return
    getDb()
      .prepare('UPDATE task_steps SET session_id = ?, updated_at = ? WHERE id = ?')
      .run(sessionId, new Date().toISOString(), stepId)
  },

  update(taskId: string, stepId: string, fields: UpdateStepInput): TaskStepRow | undefined {
    const existing = this.get(stepId)
    if (!existing || existing.task_id !== taskId) return undefined
    const db = getDb()
    const now = new Date().toISOString()
    const next: TaskStepRow = {
      ...existing,
      title: fields.title ?? existing.title,
      description: fields.description !== undefined ? fields.description : existing.description,
      assignee_agent_id:
        fields.assigneeAgentId !== undefined ? fields.assigneeAgentId : existing.assignee_agent_id,
      session_id: fields.sessionId !== undefined ? fields.sessionId : existing.session_id,
      updated_at: now,
    }
    const apply = db.transaction(() => {
      db.prepare(
        `UPDATE task_steps
         SET title = @title,
             description = @description,
             assignee_agent_id = @assignee_agent_id,
             session_id = @session_id,
             updated_at = @updated_at
         WHERE id = @id`,
      ).run(next)
      if (fields.dependsOn !== undefined) {
        this.replaceDependencies(taskId, stepId, fields.dependsOn)
      }
    })
    apply()
    return this.get(stepId)
  },

  delete(taskId: string, stepId: string): void {
    const existing = this.get(stepId)
    if (!existing || existing.task_id !== taskId) return
    const db = getDb()
    const apply = db.transaction(() => {
      db.prepare('DELETE FROM task_step_dependencies WHERE depends_on_step_id = ?').run(stepId)
      db.prepare('DELETE FROM task_step_dependencies WHERE step_id = ?').run(stepId)
      db.prepare('DELETE FROM task_steps WHERE id = ?').run(stepId)
    })
    apply()
  },

  updateStatus(stepId: string, status: string, stage?: string): void {
    const existing = this.get(stepId)
    if (!existing) return
    const nextStage = stage !== undefined ? stage : existing.current_stage
    getDb()
      .prepare('UPDATE task_steps SET status = ?, current_stage = ?, updated_at = ? WHERE id = ?')
      .run(status, nextStage, new Date().toISOString(), stepId)
  },

  updateStage(stepId: string, stage: string): void {
    const existing = this.get(stepId)
    if (!existing) return
    getDb()
      .prepare('UPDATE task_steps SET current_stage = ?, updated_at = ? WHERE id = ?')
      .run(stage, new Date().toISOString(), stepId)
  },

  replaceDependencies(taskId: string, stepId: string, dependsOn: string[]): void {
    const db = getDb()
    const now = new Date().toISOString()
    const unique = Array.from(new Set(dependsOn))
    const apply = db.transaction(() => {
      db.prepare('DELETE FROM task_step_dependencies WHERE step_id = ?').run(stepId)
      const stmt = db.prepare(
        `INSERT INTO task_step_dependencies (step_id, depends_on_step_id, task_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      for (const dep of unique) stmt.run(stepId, dep, taskId, now)
    })
    apply()
  },

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

export function detectCycle(taskId: string, stepId: string, newDependsOn: string[]): boolean {
  const all = taskStepStore.listByTask(taskId)
  const byId = new Map(all.map(s => [s.id, s]))
  if (newDependsOn.includes(stepId)) return true
  const adj = new Map<string, string[]>()
  for (const s of all) {
    adj.set(s.id, s.id === stepId ? newDependsOn.slice() : taskStepStore.listDependencies(s.id))
  }
  if (!byId.has(stepId)) adj.set(stepId, newDependsOn.slice())
  const visited = new Set<string>()
  const stack = new Set<string>()
  function dfs(node: string): boolean {
    if (stack.has(node)) return true
    if (visited.has(node)) return false
    visited.add(node)
    stack.add(node)
    const deps = adj.get(node) ?? []
    for (const dep of deps) {
      if (!byId.has(dep) && dep !== stepId) continue
      if (dfs(dep)) return true
    }
    stack.delete(node)
    return false
  }
  return dfs(stepId)
}
