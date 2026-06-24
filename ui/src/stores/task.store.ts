import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import type { ImageAttachmentInfo } from './session-events'

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
  team_id?: string | null
  assignee_member_id?: string | null
  agent_report_status?: string | null
  sessionId?: string
}

export interface TaskEventData {
  id: string
  task_id: string
  type: string
  payload_json: string
  sequence: number
  created_at: string
}

export type SessionMode = 'existing' | 'new_each' | 'new_fixed'

export function mergeTaskById(tasks: TaskData[], incoming: TaskData): TaskData[] {
  const existingIndex = tasks.findIndex((task) => task.id === incoming.id)
  if (existingIndex < 0) return [incoming, ...tasks]
  return tasks.map((task, index) => (index === existingIndex ? { ...task, ...incoming } : task))
}

interface TaskStore {
  tasks: TaskData[]
  loading: boolean
  fetchTasks: (projectId?: string) => Promise<void>
  createTask: (title: string, description?: string, assignAgentId?: string, projectId?: string, sessionId?: string, sessionMode?: SessionMode, images?: ImageAttachmentInfo[]) => Promise<TaskData>
  updateTask: (taskId: string, status: string, stage?: string, reason?: string) => Promise<TaskData>
  updateTaskInfo: (taskId: string, fields: { title?: string; description?: string }) => Promise<TaskData>
  deleteTask: (taskId: string) => Promise<void>
  assignTask: (taskId: string, agentId: string, sessionId?: string, sessionMode?: SessionMode) => Promise<TaskData>
  replyTask: (taskId: string, message: string) => Promise<TaskData>
  fetchTaskEvents: (taskId: string, afterSequence?: number) => Promise<TaskEventData[]>
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
      const data = (await wsClient.request(msg)) as TaskData[]
      set({ tasks: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createTask: async (title, description, assignAgentId, projectId, sessionId, sessionMode, images) => {
    const msg: Record<string, unknown> = { type: 'tasks.create', title }
    if (description) msg.description = description
    if (assignAgentId) msg.assignAgentId = assignAgentId
    if (projectId) msg.projectId = projectId
    if (sessionId) msg.sessionId = sessionId
    if (sessionMode) msg.sessionMode = sessionMode
    if (images?.length) msg.images = images
    const task = (await wsClient.request(msg)) as TaskData
    set({ tasks: mergeTaskById(get().tasks, task) })
    return task
  },

  updateTask: async (taskId, status, stage, reason) => {
    const msg: Record<string, unknown> = { type: 'tasks.update', taskId, status }
    if (stage !== undefined) msg.stage = stage
    if (reason !== undefined) msg.reason = reason
    const task = (await wsClient.request(msg)) as TaskData
    set({ tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, ...task } : t)) })
    return task
  },

  updateTaskInfo: async (taskId, fields) => {
    const msg: Record<string, unknown> = { type: 'tasks.update', taskId }
    if (fields.title !== undefined) msg.title = fields.title
    if (fields.description !== undefined) msg.description = fields.description
    const task = (await wsClient.request(msg)) as TaskData
    set({ tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, ...task } : t)) })
    return task
  },

  deleteTask: async (taskId) => {
    await wsClient.request({ type: 'tasks.delete', taskId })
    set({ tasks: get().tasks.filter((t) => t.id !== taskId) })
  },

  assignTask: async (taskId, agentId, sessionId, sessionMode) => {
    const msg: Record<string, unknown> = { type: 'tasks.assign', taskId, agentId }
    if (sessionId) msg.sessionId = sessionId
    if (sessionMode) msg.sessionMode = sessionMode
    const task = (await wsClient.request(msg)) as TaskData
    set({ tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, ...task } : t)) })
    return task
  },

  replyTask: async (taskId, message) => {
    const task = (await wsClient.request({ type: 'tasks.reply', taskId, message })) as TaskData
    set({ tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, ...task } : t)) })
    return task
  },

  fetchTaskEvents: async (taskId, afterSequence) => {
    const msg: Record<string, unknown> = { type: 'tasks.events.list', taskId }
    if (afterSequence != null) msg.afterSequence = afterSequence
    const events = (await wsClient.request(msg)) as TaskEventData[]
    return events
  },

  setupListeners: () => {
    const off = wsClient.on('task:update', (msg) => {
      const taskId = msg.taskId as string
      const data = msg.data as Record<string, unknown>
      if (data.event === 'deleted') {
        set({ tasks: get().tasks.filter((t) => t.id !== taskId) })
        return
      }
      const existing = get().tasks.find((t) => t.id === taskId)
      if (existing) {
        set({ tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, ...data } : t)) })
      } else if (data.id) {
        set({ tasks: mergeTaskById(get().tasks, data as unknown as TaskData) })
      }
    })
    return off
  },
}))
