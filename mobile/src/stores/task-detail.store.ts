import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'
import type { TaskStatus } from '../../../src/types/ws-protocol'

export interface TaskSessionRef {
  id: string
  agentId: string | null
  status: string | null
  startedAt: string | null
}

export interface TaskDetail {
  id: string
  title: string
  description: string | null
  source: string
  status: TaskStatus
  stage: string
  assigned_agent_id: string | null
  created_at: string
  completed_at: string | null
  project_id: string | null
  agent_report_status: string | null
  execution_mode_id: string | null
  sessions: TaskSessionRef[]
  latestReportAt?: string | null
  latestReportType?: string | null
  latestReportPreview?: string | null
}

export interface TaskEventItem {
  id: string
  task_id: string
  type: string
  payload_json: string
  sequence: number
  created_at: string
}

export interface TaskReportDetail {
  id: string
  taskId: string
  type: string
  sequence: number
  createdAt: string
  reportMd: string | null
  agentStatus: string | null
}

interface TaskDetailState {
  taskId: string | null
  task: TaskDetail | null
  events: TaskEventItem[]
  loading: boolean
  eventsLoading: boolean
  error: string | null

  load: (taskId: string) => Promise<void>
  reloadEvents: () => Promise<void>
  updateStatus: (status: TaskStatus, reason?: string) => Promise<void>
  deleteTask: () => Promise<void>
  reset: () => void
}

let lastLoadToken = 0

export const useTaskDetailStore = create<TaskDetailState>((set, get) => ({
  taskId: null,
  task: null,
  events: [],
  loading: false,
  eventsLoading: false,
  error: null,

  load: async (taskId: string) => {
    const token = ++lastLoadToken
    set({ taskId, loading: true, eventsLoading: true, error: null })
    try {
      const task = await wsClient.request({ type: 'tasks.get', taskId }) as TaskDetail
      if (token !== lastLoadToken) return
      set({ task, loading: false })
    } catch (err) {
      if (token !== lastLoadToken) return
      set({ loading: false, error: err instanceof Error ? err.message : '加载失败' })
      return
    }
    try {
      const events = await wsClient.request({ type: 'tasks.events.list', taskId }) as TaskEventItem[]
      if (token !== lastLoadToken) return
      set({ events: events ?? [], eventsLoading: false })
    } catch {
      if (token === lastLoadToken) set({ eventsLoading: false })
    }
  },

  reloadEvents: async () => {
    const taskId = get().taskId
    if (!taskId) return
    try {
      const events = await wsClient.request({ type: 'tasks.events.list', taskId }) as TaskEventItem[]
      set({ events: events ?? [] })
    } catch { /* ignore */ }
  },

  updateStatus: async (status, reason) => {
    const taskId = get().taskId
    if (!taskId) return
    await wsClient.request({ type: 'tasks.update', taskId, status, reason })
    await get().load(taskId)
  },

  deleteTask: async () => {
    const taskId = get().taskId
    if (!taskId) return
    await wsClient.request({ type: 'tasks.delete', taskId })
  },

  reset: () => {
    lastLoadToken++
    set({ taskId: null, task: null, events: [], loading: false, eventsLoading: false, error: null })
  },
}))

export function parseEventPayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function getReportPreview(payload: Record<string, unknown>): string | null {
  const md = payload.report_md
  if (typeof md !== 'string' || !md) return null
  const firstLine = md.split('\n')[0]?.trim() ?? ''
  if (!firstLine) return null
  return firstLine.slice(0, 50)
}

export function getEventStage(payload: Record<string, unknown>): string | null {
  const stage = payload.stage
  return typeof stage === 'string' && stage ? stage : null
}

export function getEventStatusChange(payload: Record<string, unknown>): { from?: string; to?: string } | null {
  const from = payload.from_status
  const to = payload.to_status
  if (typeof from !== 'string' && typeof to !== 'string') return null
  return {
    from: typeof from === 'string' ? from : undefined,
    to: typeof to === 'string' ? to : undefined,
  }
}
