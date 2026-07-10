import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import { useProjectStore } from './project.store'

export interface TaskStepData {
  id: string
  title: string
  status: string
  assignee: string | null
  sessionId: string | null
  dependsOn: string[]
  currentStage: string | null
}

export interface TaskStepProgress {
  done: number
  total: number
}

export interface TaskStepReport {
  agentStatus: string
  reportMd: string | null
  artifacts?: Array<{ type: 'commit' | 'file' | 'doc' | 'url'; value: string }>
  agentId: string
  sessionId: string
  time: string
}

export interface TaskStepDetailView extends TaskStepData {
  description: string | null
  reports: TaskStepReport[]
}

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
  execution_mode_id?: string | null
  sessionId?: string
  steps?: TaskStepData[]
  stepProgress?: TaskStepProgress
}

export interface TaskExecutionModeData {
  id: string
  name: string
  description: string | null
  prompt_template: string
  report_template: string
  is_builtin: number
  project_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
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
  modes: TaskExecutionModeData[]
  loading: boolean
  fetchTasks: (projectId?: string) => Promise<void>
  createTask: (title: string, description: string, projectId?: string) => Promise<TaskData>
  createSimpleTask: (input: {
    title: string
    description: string
    assignee: string
    projectId?: string
    sessionId?: string
  }) => Promise<TaskData>
  updateTask: (taskId: string, status: string, stage?: string, reason?: string) => Promise<TaskData>
  updateTaskInfo: (taskId: string, fields: { title?: string; description?: string }) => Promise<TaskData>
  deleteTask: (taskId: string) => Promise<void>
  assignTask: (taskId: string, agentId: string, sessionId?: string, sessionMode?: SessionMode) => Promise<TaskData>
  replyTask: (taskId: string, message: string) => Promise<TaskData>
  fetchTaskEvents: (taskId: string, afterSequence?: number) => Promise<TaskEventData[]>
  startTask: (taskId: string) => Promise<TaskData>
  fetchTaskSteps: (taskId: string) => Promise<{ steps: TaskStepData[]; stepProgress: TaskStepProgress }>
  addStep: (input: {
    taskId: string
    title: string
    description?: string
    assignee?: string
    sessionId?: string
    dependsOn?: string[]
  }) => Promise<{ steps: TaskStepData[]; stepProgress: TaskStepProgress }>
  updateStep: (input: {
    taskId: string
    stepId: string
    title?: string
    description?: string | null
    assignee?: string | null
    sessionId?: string | null
    dependsOn?: string[]
  }) => Promise<{ steps: TaskStepData[]; stepProgress: TaskStepProgress }>
  removeStep: (taskId: string, stepId: string) => Promise<{ steps: TaskStepData[]; stepProgress: TaskStepProgress }>
  fetchStepDetail: (taskId: string, stepId: string) => Promise<TaskStepDetailView>
  fetchModes: (projectId?: string) => Promise<TaskExecutionModeData[]>
  createMode: (input: {
    name: string
    description?: string
    promptTemplate?: string
    reportTemplate?: string
    projectId?: string
  }) => Promise<TaskExecutionModeData>
  updateMode: (
    id: string,
    fields: {
      name?: string
      description?: string | null
      promptTemplate?: string
      reportTemplate?: string
      sortOrder?: number
    },
  ) => Promise<TaskExecutionModeData>
  deleteMode: (id: string) => Promise<void>
  setupListeners: () => () => void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  modes: [],
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

  createTask: async (title, description, projectId) => {
    const msg: Record<string, unknown> = { type: 'tasks.create', title, description }
    if (projectId) msg.projectId = projectId
    const task = (await wsClient.request(msg)) as TaskData
    set({ tasks: mergeTaskById(get().tasks, task) })
    return task
  },

  createSimpleTask: async (input) => {
    const msg: Record<string, unknown> = {
      type: 'tasks.createSimple',
      title: input.title,
      description: input.description,
      assignee: input.assignee,
    }
    if (input.projectId) msg.projectId = input.projectId
    if (input.sessionId) msg.sessionId = input.sessionId
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

  startTask: async (taskId) => {
    const result = (await wsClient.request({ type: 'tasks.start', taskId })) as {
      taskId: string
      status: string
      steps: TaskStepData[]
      stepProgress: TaskStepProgress
    }
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId ? { ...t, status: result.status, steps: result.steps, stepProgress: result.stepProgress } : t,
      ),
    })
    return get().tasks.find((t) => t.id === taskId)!
  },

  fetchTaskSteps: async (taskId) => {
    const result = (await wsClient.request({ type: 'tasks.step.list', taskId })) as {
      steps: TaskStepData[]
      stepProgress: TaskStepProgress
    }
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId ? { ...t, steps: result.steps, stepProgress: result.stepProgress } : t,
      ),
    })
    return result
  },

  addStep: async (input) => {
    const msg: Record<string, unknown> = { type: 'tasks.step.add', taskId: input.taskId, title: input.title }
    if (input.description !== undefined) msg.description = input.description
    if (input.assignee !== undefined) msg.assignee = input.assignee
    if (input.sessionId !== undefined) msg.sessionId = input.sessionId
    if (input.dependsOn !== undefined) msg.dependsOn = input.dependsOn
    const result = (await wsClient.request(msg)) as {
      steps: TaskStepData[]
      stepProgress: TaskStepProgress
      taskStatus?: string
    }
    set({
      tasks: get().tasks.map((t) =>
        t.id === input.taskId
          ? {
              ...t,
              steps: result.steps,
              stepProgress: result.stepProgress,
              status: result.taskStatus ?? t.status,
            }
          : t,
      ),
    })
    return { steps: result.steps, stepProgress: result.stepProgress }
  },

  updateStep: async (input) => {
    const msg: Record<string, unknown> = { type: 'tasks.step.update', taskId: input.taskId, stepId: input.stepId }
    if (input.title !== undefined) msg.title = input.title
    if (input.description !== undefined) msg.description = input.description
    if (input.assignee !== undefined) msg.assignee = input.assignee
    if (input.sessionId !== undefined) msg.sessionId = input.sessionId
    if (input.dependsOn !== undefined) msg.dependsOn = input.dependsOn
    const result = (await wsClient.request(msg)) as {
      steps: TaskStepData[]
      stepProgress: TaskStepProgress
      taskStatus?: string
    }
    set({
      tasks: get().tasks.map((t) =>
        t.id === input.taskId
          ? {
              ...t,
              steps: result.steps,
              stepProgress: result.stepProgress,
              status: result.taskStatus ?? t.status,
            }
          : t,
      ),
    })
    return { steps: result.steps, stepProgress: result.stepProgress }
  },

  removeStep: async (taskId, stepId) => {
    const result = (await wsClient.request({ type: 'tasks.step.remove', taskId, stepId })) as {
      steps: TaskStepData[]
      stepProgress: TaskStepProgress
      taskStatus?: string
    }
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: result.steps,
              stepProgress: result.stepProgress,
              status: result.taskStatus ?? t.status,
            }
          : t,
      ),
    })
    return { steps: result.steps, stepProgress: result.stepProgress }
  },

  fetchStepDetail: async (taskId, stepId) => {
    return (await wsClient.request({ type: 'tasks.step.get', taskId, stepId })) as TaskStepDetailView
  },

  fetchModes: async (projectId) => {
    const msg: Record<string, unknown> = { type: 'tasks.modes.list' }
    if (projectId) msg.projectId = projectId
    const modes = (await wsClient.request(msg)) as TaskExecutionModeData[]
    set({ modes })
    return modes
  },

  createMode: async (input) => {
    const msg: Record<string, unknown> = { type: 'tasks.modes.create', name: input.name }
    if (input.description !== undefined) msg.description = input.description
    if (input.promptTemplate !== undefined) msg.promptTemplate = input.promptTemplate
    if (input.reportTemplate !== undefined) msg.reportTemplate = input.reportTemplate
    if (input.projectId !== undefined) msg.projectId = input.projectId
    const mode = (await wsClient.request(msg)) as TaskExecutionModeData
    set({ modes: [...get().modes.filter((m) => m.id !== mode.id), mode] })
    return mode
  },

  updateMode: async (id, fields) => {
    const msg: Record<string, unknown> = { type: 'tasks.modes.update', id }
    if (fields.name !== undefined) msg.name = fields.name
    if (fields.description !== undefined) msg.description = fields.description
    if (fields.promptTemplate !== undefined) msg.promptTemplate = fields.promptTemplate
    if (fields.reportTemplate !== undefined) msg.reportTemplate = fields.reportTemplate
    if (fields.sortOrder !== undefined) msg.sortOrder = fields.sortOrder
    const mode = (await wsClient.request(msg)) as TaskExecutionModeData
    set({ modes: get().modes.map((m) => (m.id === id ? mode : m)) })
    return mode
  },

  deleteMode: async (id) => {
    await wsClient.request({ type: 'tasks.modes.delete', id })
    set({ modes: get().modes.filter((m) => m.id !== id) })
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
        const patch: Partial<TaskData> = { ...data } as Partial<TaskData>
        if (Array.isArray(data.steps)) patch.steps = data.steps as TaskStepData[]
        if (data.stepProgress && typeof data.stepProgress === 'object') {
          patch.stepProgress = data.stepProgress as TaskStepProgress
        }
        set({ tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })
      } else if (data.id) {
        const currentProjectId = useProjectStore.getState().currentProjectId
        const taskProjectId = (data as { project_id?: string | null }).project_id
        if (currentProjectId && taskProjectId && taskProjectId !== currentProjectId) {
          return
        }
        set({ tasks: mergeTaskById(get().tasks, data as unknown as TaskData) })
      }
    })
    return off
  },
}))
