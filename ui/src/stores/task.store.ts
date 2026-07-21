import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import { queryClient } from '../services/query-client'
import {
  ALL_PROJECTS_SCOPE,
  beginProjectRequest,
  clearProjectCache,
  commitProjectResponse,
  emptyProjectCache,
  invalidateProjectCache,
  patchCachedArrays,
  projectScopeKey,
  pruneProjectCache,
  readProjectCache,
  removeCachedArrayItem,
  setProjectCacheError,
  shouldRefreshProjectCache,
  touchProjectCache,
  upsertCachedArrayItem,
  type ProjectCacheState,
} from './project-cache'

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
  initiator_agent_id?: string | null
  initiator_session_id?: string | null
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

const taskFetches = new Map<string, Promise<void>>()
const modeFetches = new Map<string, Promise<TaskExecutionModeData[]>>()

function mergeTaskIntoCache(
  cache: ProjectCacheState<TaskData[]>,
  task: TaskData,
): ProjectCacheState<TaskData[]> {
  let next = patchCachedArrays(cache, task.id, task)
  if (task.project_id) next = upsertCachedArrayItem(next, task.project_id, task)
  next = upsertCachedArrayItem(next, ALL_PROJECTS_SCOPE, task)
  return next
}

function mergeModeIntoCache(
  cache: ProjectCacheState<TaskExecutionModeData[]>,
  mode: TaskExecutionModeData,
): ProjectCacheState<TaskExecutionModeData[]> {
  let next = patchCachedArrays(cache, mode.id, mode)
  if (mode.project_id) next = upsertCachedArrayItem(next, mode.project_id, mode)
  next = upsertCachedArrayItem(next, ALL_PROJECTS_SCOPE, mode)
  return next
}

interface TaskStore {
  tasks: TaskData[]
  modes: TaskExecutionModeData[]
  loading: boolean
  refreshing: boolean
  activeScope: string
  taskCache: ProjectCacheState<TaskData[]>
  modeCache: ProjectCacheState<TaskExecutionModeData[]>
  activateProject: (projectId?: string | null) => void
  fetchTasks: (projectId?: string, options?: { force?: boolean }) => Promise<void>
  invalidateProject: (projectId?: string | null) => void
  clearProjectCache: (projectId: string) => void
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
  refreshing: false,
  activeScope: ALL_PROJECTS_SCOPE,
  taskCache: emptyProjectCache<TaskData[]>(),
  modeCache: emptyProjectCache<TaskExecutionModeData[]>(),

  activateProject: (projectId) => {
    const scope = projectScopeKey(projectId)
    set((state) => {
      const taskCache = pruneProjectCache(touchProjectCache(state.taskCache, scope), scope)
      const modeCache = pruneProjectCache(touchProjectCache(state.modeCache, scope), scope)
      return {
        activeScope: scope,
        taskCache,
        modeCache,
        tasks: readProjectCache(taskCache, scope)?.data ?? [],
        modes: readProjectCache(modeCache, scope)?.data ?? [],
        loading: false,
        refreshing: false,
      }
    })
  },

  fetchTasks: async (projectId, options) => {
    const scope = projectScopeKey(projectId)
    const cached = readProjectCache(get().taskCache, scope)
    if (!options?.force && cached && !shouldRefreshProjectCache(cached)) return
    const inFlight = taskFetches.get(scope)
    if (!options?.force && inFlight) return inFlight

    let requestSeq = 0
    set((state) => {
      const request = beginProjectRequest(state.taskCache, scope)
      requestSeq = request.requestSeq
      const isActive = state.activeScope === scope
      return {
        taskCache: request.state,
        loading: isActive && !cached,
        refreshing: isActive && !!cached,
      }
    })

    const request = (async (): Promise<void> => {
      try {
        const data = await queryClient.listTasks({ projectId })
        set((state) => {
          const taskCache = pruneProjectCache(commitProjectResponse(state.taskCache, {
            scope,
            requestSeq,
            data,
          }), state.activeScope)
          const isActive = state.activeScope === scope
          return {
            taskCache,
            tasks: isActive ? (readProjectCache(taskCache, scope)?.data ?? []) : state.tasks,
            loading: isActive ? false : state.loading,
            refreshing: isActive ? false : state.refreshing,
          }
        })
      } catch (error) {
        set((state) => {
          const isActive = state.activeScope === scope
          return {
            taskCache: setProjectCacheError(
              state.taskCache,
              scope,
              error instanceof Error ? error.message : '任务加载失败',
            ),
            loading: isActive ? false : state.loading,
            refreshing: isActive ? false : state.refreshing,
          }
        })
      }
    })()
    taskFetches.set(scope, request)
    try {
      await request
    } finally {
      if (taskFetches.get(scope) === request) taskFetches.delete(scope)
    }
  },

  invalidateProject: (projectId) => {
    const scope = projectScopeKey(projectId)
    set((state) => ({
      taskCache: invalidateProjectCache(state.taskCache, scope),
      modeCache: invalidateProjectCache(state.modeCache, scope),
    }))
  },

  clearProjectCache: (projectId) => {
    set((state) => ({
      taskCache: clearProjectCache(state.taskCache, projectId),
      modeCache: clearProjectCache(state.modeCache, projectId),
    }))
  },

  createTask: async (title, description, projectId) => {
    const msg: Record<string, unknown> = { type: 'tasks.create', title, description }
    if (projectId) msg.projectId = projectId
    const task = (await wsClient.request(msg)) as TaskData
    set((state) => {
      const taskCache = mergeTaskIntoCache(state.taskCache, task)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? mergeTaskById(state.tasks, task),
      }
    })
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
    set((state) => {
      const taskCache = mergeTaskIntoCache(state.taskCache, task)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? mergeTaskById(state.tasks, task),
      }
    })
    return task
  },

  updateTask: async (taskId, status, stage, reason) => {
    const msg: Record<string, unknown> = { type: 'tasks.update', taskId, status }
    if (stage !== undefined) msg.stage = stage
    if (reason !== undefined) msg.reason = reason
    const task = (await wsClient.request(msg)) as TaskData
    set((state) => {
      const taskCache = mergeTaskIntoCache(state.taskCache, task)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.map((item) => item.id === taskId ? { ...item, ...task } : item),
      }
    })
    return task
  },

  updateTaskInfo: async (taskId, fields) => {
    const msg: Record<string, unknown> = { type: 'tasks.update', taskId }
    if (fields.title !== undefined) msg.title = fields.title
    if (fields.description !== undefined) msg.description = fields.description
    const task = (await wsClient.request(msg)) as TaskData
    set((state) => {
      const taskCache = mergeTaskIntoCache(state.taskCache, task)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.map((item) => item.id === taskId ? { ...item, ...task } : item),
      }
    })
    return task
  },

  deleteTask: async (taskId) => {
    await wsClient.request({ type: 'tasks.delete', taskId })
    set((state) => {
      const taskCache = removeCachedArrayItem(state.taskCache, taskId)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.filter((task) => task.id !== taskId),
      }
    })
  },

  assignTask: async (taskId, agentId, sessionId, sessionMode) => {
    const msg: Record<string, unknown> = { type: 'tasks.assign', taskId, agentId }
    if (sessionId) msg.sessionId = sessionId
    if (sessionMode) msg.sessionMode = sessionMode
    const task = (await wsClient.request(msg)) as TaskData
    set((state) => {
      const taskCache = mergeTaskIntoCache(state.taskCache, task)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.map((item) => item.id === taskId ? { ...item, ...task } : item),
      }
    })
    return task
  },

  replyTask: async (taskId, message) => {
    const task = (await wsClient.request({ type: 'tasks.reply', taskId, message })) as TaskData
    set((state) => {
      const taskCache = mergeTaskIntoCache(state.taskCache, task)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.map((item) => item.id === taskId ? { ...item, ...task } : item),
      }
    })
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
    const patch: Partial<TaskData> = {
      status: result.status,
      steps: result.steps,
      stepProgress: result.stepProgress,
    }
    set((state) => {
      const taskCache = patchCachedArrays(state.taskCache, taskId, patch)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task),
      }
    })
    return get().tasks.find((t) => t.id === taskId)!
  },

  fetchTaskSteps: async (taskId) => {
    const result = (await wsClient.request({ type: 'tasks.step.list', taskId })) as {
      steps: TaskStepData[]
      stepProgress: TaskStepProgress
    }
    const patch: Partial<TaskData> = { steps: result.steps, stepProgress: result.stepProgress }
    set((state) => {
      const taskCache = patchCachedArrays(state.taskCache, taskId, patch)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task),
      }
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
    set((state) => {
      const existing = state.tasks.find((task) => task.id === input.taskId)
      const patch: Partial<TaskData> = {
        steps: result.steps,
        stepProgress: result.stepProgress,
        ...(result.taskStatus ? { status: result.taskStatus } : {}),
      }
      const taskCache = patchCachedArrays(state.taskCache, input.taskId, patch)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.map((task) => task.id === input.taskId
            ? { ...task, ...patch, status: result.taskStatus ?? existing?.status ?? task.status }
            : task),
      }
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
    set((state) => {
      const patch: Partial<TaskData> = {
        steps: result.steps,
        stepProgress: result.stepProgress,
        ...(result.taskStatus ? { status: result.taskStatus } : {}),
      }
      const taskCache = patchCachedArrays(state.taskCache, input.taskId, patch)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.map((task) => task.id === input.taskId ? { ...task, ...patch } : task),
      }
    })
    return { steps: result.steps, stepProgress: result.stepProgress }
  },

  removeStep: async (taskId, stepId) => {
    const result = (await wsClient.request({ type: 'tasks.step.remove', taskId, stepId })) as {
      steps: TaskStepData[]
      stepProgress: TaskStepProgress
      taskStatus?: string
    }
    set((state) => {
      const patch: Partial<TaskData> = {
        steps: result.steps,
        stepProgress: result.stepProgress,
        ...(result.taskStatus ? { status: result.taskStatus } : {}),
      }
      const taskCache = patchCachedArrays(state.taskCache, taskId, patch)
      return {
        taskCache,
        tasks: readProjectCache(taskCache, state.activeScope)?.data
          ?? state.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task),
      }
    })
    return { steps: result.steps, stepProgress: result.stepProgress }
  },

  fetchStepDetail: async (taskId, stepId) => {
    return (await wsClient.request({ type: 'tasks.step.get', taskId, stepId })) as TaskStepDetailView
  },

  fetchModes: async (projectId) => {
    const scope = projectScopeKey(projectId)
    const cached = readProjectCache(get().modeCache, scope)
    if (cached && !shouldRefreshProjectCache(cached)) {
      if (get().activeScope === scope) set({ modes: cached.data })
      return cached.data
    }
    const inFlight = modeFetches.get(scope)
    if (inFlight) return inFlight
    let requestSeq = 0
    set((state) => {
      const request = beginProjectRequest(state.modeCache, scope)
      requestSeq = request.requestSeq
      return { modeCache: request.state }
    })
    const msg: Record<string, unknown> = { type: 'tasks.modes.list' }
    if (projectId) msg.projectId = projectId
    const request = (async (): Promise<TaskExecutionModeData[]> => {
      const modes = (await wsClient.request(msg)) as TaskExecutionModeData[]
      set((state) => {
        const modeCache = commitProjectResponse(state.modeCache, { scope, requestSeq, data: modes })
        return {
          modeCache,
          modes: state.activeScope === scope ? modes : state.modes,
        }
      })
      return modes
    })()
    modeFetches.set(scope, request)
    try {
      return await request
    } finally {
      if (modeFetches.get(scope) === request) modeFetches.delete(scope)
    }
  },

  createMode: async (input) => {
    const msg: Record<string, unknown> = { type: 'tasks.modes.create', name: input.name }
    if (input.description !== undefined) msg.description = input.description
    if (input.promptTemplate !== undefined) msg.promptTemplate = input.promptTemplate
    if (input.reportTemplate !== undefined) msg.reportTemplate = input.reportTemplate
    if (input.projectId !== undefined) msg.projectId = input.projectId
    const mode = (await wsClient.request(msg)) as TaskExecutionModeData
    set((state) => {
      const modeCache = mergeModeIntoCache(state.modeCache, mode)
      return {
        modeCache,
        modes: readProjectCache(modeCache, state.activeScope)?.data
          ?? [...state.modes.filter((item) => item.id !== mode.id), mode],
      }
    })
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
    set((state) => {
      const modeCache = mergeModeIntoCache(state.modeCache, mode)
      return {
        modeCache,
        modes: readProjectCache(modeCache, state.activeScope)?.data
          ?? state.modes.map((item) => item.id === id ? mode : item),
      }
    })
    return mode
  },

  deleteMode: async (id) => {
    await wsClient.request({ type: 'tasks.modes.delete', id })
    set((state) => {
      const modeCache = removeCachedArrayItem(state.modeCache, id)
      return {
        modeCache,
        modes: readProjectCache(modeCache, state.activeScope)?.data
          ?? state.modes.filter((mode) => mode.id !== id),
      }
    })
  },

  setupListeners: () => {
    const off = wsClient.on('task:update', (msg) => {
      const taskId = msg.taskId as string
      const data = msg.data as Record<string, unknown>
      if (data.event === 'deleted') {
        set((state) => {
          const taskCache = removeCachedArrayItem(state.taskCache, taskId)
          return {
            taskCache,
            tasks: readProjectCache(taskCache, state.activeScope)?.data
              ?? state.tasks.filter((task) => task.id !== taskId),
          }
        })
        return
      }
      const patch: Partial<TaskData> = { ...data } as Partial<TaskData>
      if (Array.isArray(data.steps)) patch.steps = data.steps as TaskStepData[]
      if (data.stepProgress && typeof data.stepProgress === 'object') {
        patch.stepProgress = data.stepProgress as TaskStepProgress
      }
      set((state) => {
        const complete = typeof data.id === 'string' && typeof data.title === 'string'
        const taskCache = complete
          ? mergeTaskIntoCache(state.taskCache, data as unknown as TaskData)
          : patchCachedArrays(state.taskCache, taskId, patch)
        const activeCached = readProjectCache(taskCache, state.activeScope)?.data
        const tasks = activeCached ?? (state.tasks.some((task) => task.id === taskId)
          ? state.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task)
          : complete && (
            state.activeScope === ALL_PROJECTS_SCOPE
            || (data as { project_id?: string }).project_id === state.activeScope
          )
            ? mergeTaskById(state.tasks, data as unknown as TaskData)
            : state.tasks)
        return { taskCache, tasks }
      })
    })
    return off
  },
}))
