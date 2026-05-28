import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface TaskData {
  id: string
  title: string
  description: string | null
  source: string
  status: string
  stage: string
  assigned_agent_id: string | null
  created_at: string
  completed_at: string | null
  project_id?: string | null
  sessionId?: string
}

interface TaskStore {
  tasks: TaskData[]
  loading: boolean
  fetchTasks: (projectId?: string) => Promise<void>
  createTask: (title: string, description?: string, assignAgentId?: string, projectId?: string) => Promise<TaskData>
  updateTask: (taskId: string, status: string, stage?: string) => Promise<TaskData>
  setupListeners: () => () => void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,

  fetchTasks: async (projectId) => {
    set({ loading: true })
    try {
      const msg: Record<string, unknown> = { type: 'tasks.list' }
      if (projectId) msg.projectId = projectId
      const data = await wsClient.request(msg) as TaskData[]
      set({ tasks: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createTask: async (title, description, assignAgentId, projectId) => {
    const msg: Record<string, unknown> = { type: 'tasks.create', title }
    if (description) msg.description = description
    if (assignAgentId) msg.assignAgentId = assignAgentId
    if (projectId) msg.projectId = projectId
    const task = await wsClient.request(msg) as TaskData
    set({ tasks: [task, ...get().tasks] })
    return task
  },

  updateTask: async (taskId, status, stage) => {
    const msg: Record<string, unknown> = { type: 'tasks.update', taskId, status }
    if (stage !== undefined) msg.stage = stage
    const task = await wsClient.request(msg) as TaskData
    set({ tasks: get().tasks.map(t => t.id === taskId ? { ...t, ...task } : t) })
    return task
  },

  setupListeners: () => {
    const off = wsClient.on('task:update', (msg) => {
      const taskId = msg.taskId as string
      const data = msg.data as Record<string, unknown>
      set({
        tasks: get().tasks.map(t => t.id === taskId ? { ...t, ...data } : t),
      })
    })
    return off
  },
}))
