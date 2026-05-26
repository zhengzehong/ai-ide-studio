import { randomUUID } from 'crypto'
import { getData, persist } from './db.js'

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

export interface CreateTaskInput {
  title: string
  description?: string
  source?: string
  assignAgentId?: string
}

export const taskStore = {
  create(input: CreateTaskInput): TaskRow {
    const data = getData()
    const id = `task-${randomUUID().slice(0, 8)}`
    const task: TaskRow = {
      id,
      title: input.title,
      description: input.description || null,
      source: input.source || 'human',
      status: 'backlog',
      stage: '',
      assigned_agent_id: input.assignAgentId || null,
      created_at: new Date().toISOString(),
      completed_at: null,
    }
    data.tasks[id] = task
    persist()
    return task
  },

  get(id: string): TaskRow | undefined {
    const data = getData()
    return data.tasks[id] as TaskRow | undefined
  },

  list(status?: string): TaskRow[] {
    const data = getData()
    const all = Object.values(data.tasks) as TaskRow[]
    if (status) return all.filter((t) => t.status === status)
    return all
  },

  updateStatus(id: string, status: string, stage?: string): void {
    const data = getData()
    const task = data.tasks[id] as TaskRow | undefined
    if (!task) return
    task.status = status
    if (stage !== undefined) task.stage = stage
    if (status === 'completed' || status === 'cancelled') {
      task.completed_at = new Date().toISOString()
    }
    persist()
  },

  assignAgent(taskId: string, agentId: string): void {
    const data = getData()
    const task = data.tasks[taskId] as TaskRow | undefined
    if (task) {
      task.assigned_agent_id = agentId
      persist()
    }
  },

  delete(id: string): void {
    const data = getData()
    delete data.tasks[id]
    persist()
  },
}
