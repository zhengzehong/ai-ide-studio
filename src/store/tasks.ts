import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface TaskRow {
  id: string
  title: string
  description: string | null
  source: string
  status: string
  stage: string
  assigned_agent_id: string | null
  created_at: string
  completed_at: string | null
}

export interface TaskEventRow {
  id: string
  task_id: string
  type: string
  payload_json: string
  sequence: number
  created_at: string
}

export interface CreateTaskInput {
  title: string
  description?: string
  source?: string
  assignAgentId?: string
}

export interface AppendTaskEventInput {
  type: string
  payload: unknown
}

export const taskStore = {
  create(input: CreateTaskInput): TaskRow {
    const task: TaskRow = {
      id: `task-${randomUUID().slice(0, 8)}`,
      title: input.title,
      description: input.description || null,
      source: input.source || 'human',
      status: 'backlog',
      stage: '',
      assigned_agent_id: input.assignAgentId || null,
      created_at: new Date().toISOString(),
      completed_at: null,
    }
    getDb().prepare(`
      INSERT INTO tasks (id, title, description, source, status, stage, assigned_agent_id, created_at, completed_at)
      VALUES (@id, @title, @description, @source, @status, @stage, @assigned_agent_id, @created_at, @completed_at)
    `).run(task)
    taskEventStore.append(task.id, { type: 'created', payload: { task } })
    return task
  },

  get(id: string): TaskRow | undefined {
    return getDb().prepare<[string], TaskRow>('SELECT * FROM tasks WHERE id = ?').get(id)
  },

  list(status?: string): TaskRow[] {
    if (status) {
      return getDb().prepare<[string], TaskRow>('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC').all(status)
    }
    return getDb().prepare<[], TaskRow>('SELECT * FROM tasks ORDER BY created_at ASC').all()
  },

  updateStatus(id: string, status: string, stage?: string): void {
    const existing = taskStore.get(id)
    if (!existing) return

    const nextStage = stage !== undefined ? stage : existing.stage
    const completedAt = status === 'completed' || status === 'cancelled' ? new Date().toISOString() : existing.completed_at
    getDb().prepare(`
      UPDATE tasks
      SET status = ?, stage = ?, completed_at = ?
      WHERE id = ?
    `).run(status, nextStage, completedAt, id)
    taskEventStore.append(id, {
      type: 'status_changed',
      payload: { from_status: existing.status, to_status: status, stage: nextStage },
    })
  },

  assignAgent(taskId: string, agentId: string): void {
    const existing = taskStore.get(taskId)
    if (!existing) return
    getDb().prepare('UPDATE tasks SET assigned_agent_id = ? WHERE id = ?').run(agentId, taskId)
    taskEventStore.append(taskId, { type: 'assigned_agent', payload: { from_agent_id: existing.assigned_agent_id, to_agent_id: agentId } })
  },

  delete(id: string): void {
    if (!taskStore.get(id)) return
    taskEventStore.append(id, { type: 'deleted', payload: { task_id: id } })
    getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
  },
}

export const taskEventStore = {
  append(taskId: string, input: AppendTaskEventInput): TaskEventRow {
    const db = getDb()
    const last = db.prepare<[string], { sequence: number }>('SELECT sequence FROM task_events WHERE task_id = ? ORDER BY sequence DESC LIMIT 1').get(taskId)
    const ev: TaskEventRow = {
      id: `tevt-${randomUUID().slice(0, 8)}`,
      task_id: taskId,
      type: input.type,
      payload_json: JSON.stringify(input.payload),
      sequence: (last?.sequence ?? 0) + 1,
      created_at: new Date().toISOString(),
    }
    db.prepare(`
      INSERT INTO task_events (id, task_id, type, payload_json, sequence, created_at)
      VALUES (@id, @task_id, @type, @payload_json, @sequence, @created_at)
    `).run(ev)
    return ev
  },

  list(taskId: string, opts?: { limit?: number; afterSequence?: number }): TaskEventRow[] {
    const limit = opts?.limit || 500
    if (opts?.afterSequence != null) {
      return getDb().prepare<{ taskId: string; afterSequence: number; limit: number }, TaskEventRow>(`
        SELECT * FROM task_events
        WHERE task_id = @taskId AND sequence > @afterSequence
        ORDER BY sequence DESC
        LIMIT @limit
      `).all({ taskId, afterSequence: opts.afterSequence, limit }).reverse()
    }
    return getDb().prepare<{ taskId: string; limit: number }, TaskEventRow>(`
      SELECT * FROM task_events
      WHERE task_id = @taskId
      ORDER BY sequence DESC
      LIMIT @limit
    `).all({ taskId, limit }).reverse()
  },
}
