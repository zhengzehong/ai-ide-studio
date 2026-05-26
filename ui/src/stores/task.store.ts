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
  sessionId?: string
}

interface TaskStore {
  tasks: TaskData[]
  loading: boolean
  fetchTasks: () => Promise<void>
  createTask: (title: string, description?: string, assignAgentId?: string) => Promise<TaskData>
  setupListeners: () => () => void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,

  fetchTasks: async () => {
    set({ loading: true })
    try {
      const data = await wsClient.request({ type: 'tasks.list' }) as TaskData[]
      set({ tasks: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createTask: async (title, description, assignAgentId) => {
    const msg: Record<string, unknown> = { type: 'tasks.create', title }
    if (description) msg.description = description
    if (assignAgentId) msg.assignAgentId = assignAgentId
    const task = await wsClient.request(msg) as TaskData
    set({ tasks: [task, ...get().tasks] })
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
