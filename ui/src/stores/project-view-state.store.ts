import { create } from 'zustand'

export const PROJECT_VIEW_STATE_STORAGE_KEY = 'ai-ide-project-view-state-v1'

export interface WorkspaceViewState {
  sidebarTab?: 'sessions' | 'files'
  selectedAgentId?: string | null
  scrollTopByPanel?: Record<string, number>
}

export interface TaskBoardViewState {
  selectedTaskId?: string | null
  statusFilter?: string
  scrollLeft?: number
  scrollTopByColumn?: Record<string, number>
}

export interface KnowledgeViewState {
  currentKbId?: string | null
  currentPageId?: string | null
  query?: string
  editingPageId?: string | null
  draftByPageKey?: Record<string, unknown>
}

export interface EventCenterViewState {
  tab?: 'events' | 'categories' | 'subscriptions'
  selectedEventId?: string | null
}

export interface AgentMemoryViewState {
  selectedAgentId?: string | null
  selectedDimensionId?: string | null
}

export interface ProjectViewState {
  workspace?: WorkspaceViewState
  tasks?: TaskBoardViewState
  knowledge?: KnowledgeViewState
  events?: EventCenterViewState
  agentMemory?: AgentMemoryViewState
}

export interface ProjectViewStateData {
  byProjectId: Record<string, ProjectViewState>
}

interface ProjectViewStateStore extends ProjectViewStateData {
  patchWorkspace: (projectId: string, patch: Partial<WorkspaceViewState>) => void
  patchTasks: (projectId: string, patch: Partial<TaskBoardViewState>) => void
  patchKnowledge: (projectId: string, patch: Partial<KnowledgeViewState>) => void
  patchEvents: (projectId: string, patch: Partial<EventCenterViewState>) => void
  patchAgentMemory: (projectId: string, patch: Partial<AgentMemoryViewState>) => void
  clearProject: (projectId: string) => void
  reconcileProjects: (validProjectIds: string[]) => void
}

export function emptyProjectViewState(): ProjectViewStateData {
  return { byProjectId: {} }
}

function storageRef(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readProjectViewState(storage: Storage | null = storageRef()): ProjectViewStateData {
  if (!storage) return emptyProjectViewState()
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PROJECT_VIEW_STATE_STORAGE_KEY) ?? '')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyProjectViewState()
    const byProjectId = (parsed as { byProjectId?: unknown }).byProjectId
    if (!byProjectId || typeof byProjectId !== 'object' || Array.isArray(byProjectId)) {
      return emptyProjectViewState()
    }
    return { byProjectId: byProjectId as Record<string, ProjectViewState> }
  } catch {
    return emptyProjectViewState()
  }
}

function persistedViewState(data: ProjectViewStateData): ProjectViewStateData {
  return {
    byProjectId: Object.fromEntries(Object.entries(data.byProjectId).map(([projectId, state]) => {
      const workspace = state.workspace
        ? {
            sidebarTab: state.workspace.sidebarTab,
            selectedAgentId: state.workspace.selectedAgentId,
          }
        : undefined
      const tasks = state.tasks
        ? {
            selectedTaskId: state.tasks.selectedTaskId,
            statusFilter: state.tasks.statusFilter,
          }
        : undefined
      return [projectId, { ...state, workspace, tasks }]
    })),
  }
}

function writeProjectViewState(data: ProjectViewStateData): void {
  const storage = storageRef()
  if (!storage) return
  try {
    storage.setItem(PROJECT_VIEW_STATE_STORAGE_KEY, JSON.stringify(persistedViewState(data)))
  } catch {
    // View restoration is best-effort when storage is unavailable or full.
  }
}

function patchPage<K extends keyof ProjectViewState>(
  state: ProjectViewStateData,
  projectId: string,
  page: K,
  patch: Partial<NonNullable<ProjectViewState[K]>>,
  persist = true,
): ProjectViewStateData {
  const project = state.byProjectId[projectId] ?? {}
  const next = {
    byProjectId: {
      ...state.byProjectId,
      [projectId]: { ...project, [page]: { ...(project[page] ?? {}), ...patch } },
    },
  }
  if (persist) writeProjectViewState(next)
  return next
}

const initialState = readProjectViewState()

export const useProjectViewStateStore = create<ProjectViewStateStore>((set) => ({
  ...initialState,
  patchWorkspace: (projectId, patch) => set((state) => patchPage(
    state,
    projectId,
    'workspace',
    patch,
    Object.keys(patch).some((key) => key !== 'scrollTopByPanel'),
  )),
  patchTasks: (projectId, patch) => set((state) => patchPage(
    state,
    projectId,
    'tasks',
    patch,
    Object.keys(patch).some((key) => key !== 'scrollLeft' && key !== 'scrollTopByColumn'),
  )),
  patchKnowledge: (projectId, patch) => set((state) => patchPage(state, projectId, 'knowledge', patch)),
  patchEvents: (projectId, patch) => set((state) => patchPage(state, projectId, 'events', patch)),
  patchAgentMemory: (projectId, patch) => set((state) => patchPage(state, projectId, 'agentMemory', patch)),
  clearProject: (projectId) => set((state) => {
    if (!(projectId in state.byProjectId)) return state
    const byProjectId = { ...state.byProjectId }
    delete byProjectId[projectId]
    const next = { byProjectId }
    writeProjectViewState(next)
    return next
  }),
  reconcileProjects: (validProjectIds) => set((state) => {
    const valid = new Set(validProjectIds)
    const byProjectId = Object.fromEntries(
      Object.entries(state.byProjectId).filter(([projectId]) => valid.has(projectId)),
    )
    if (Object.keys(byProjectId).length === Object.keys(state.byProjectId).length) return state
    const next = { byProjectId }
    writeProjectViewState(next)
    return next
  }),
}))
