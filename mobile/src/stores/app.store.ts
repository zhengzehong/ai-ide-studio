import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'

export interface ProjectItem {
  id: string
  name: string
  created_at?: string
  work_dir?: string
  path?: string
  description?: string | null
  color?: string | null
  icon?: string | null
  last_visited_at?: string | null
}

export interface AgentItem {
  id: string
  name: string
  type?: string
  model?: string
  runtime?: string
  config_json?: string | null
  hidden_at?: string | null
}

interface ProjectRow {
  id: string
  name: string
  work_dir: string
  description: string | null
  created_at: string
  updated_at: string
  color: string | null
  icon: string | null
  last_visited_at: string | null
  visit_count: number
}

export interface CreateProjectInput {
  name: string
  workDir?: string
  description?: string
  color?: string
  icon?: string
}

const DRAWER_PINNED_KEY = 'mobile:drawerPinned'
const SESSION_VIEW_MODE_KEY = 'mobile:sessionViewMode'

export type MobileSessionViewMode = 'all' | 'pinned'

function readDrawerPinned(): boolean {
  try {
    return globalThis.localStorage?.getItem(DRAWER_PINNED_KEY) === '1'
  } catch {
    return false
  }
}

function writeDrawerPinned(value: boolean): void {
  try {
    if (value) globalThis.localStorage?.setItem(DRAWER_PINNED_KEY, '1')
    else globalThis.localStorage?.removeItem(DRAWER_PINNED_KEY)
  } catch {
    /* ignore */
  }
}

function readSessionViewMode(): MobileSessionViewMode {
  try {
    return globalThis.localStorage?.getItem(SESSION_VIEW_MODE_KEY) === 'pinned' ? 'pinned' : 'all'
  } catch {
    return 'all'
  }
}

function writeSessionViewMode(mode: MobileSessionViewMode): void {
  try {
    if (mode === 'pinned') globalThis.localStorage?.setItem(SESSION_VIEW_MODE_KEY, 'pinned')
    else globalThis.localStorage?.removeItem(SESSION_VIEW_MODE_KEY)
  } catch {
    /* ignore */
  }
}

interface AppState {
  projects: ProjectItem[]
  agents: AgentItem[]
  currentProjectId: string | null
  isDrawerPinned: boolean
  sessionViewMode: MobileSessionViewMode
  fetchProjects: () => Promise<void>
  fetchAgents: (projectId?: string) => Promise<void>
  setCurrentProject: (id: string | null) => void
  setDrawerPinned: (value: boolean) => void
  setSessionViewMode: (mode: MobileSessionViewMode) => void
  createProject: (input: CreateProjectInput) => Promise<ProjectRow>
}

function mapProjectRow(row: ProjectRow): ProjectItem {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    work_dir: row.work_dir,
    description: row.description,
    color: row.color,
    icon: row.icon,
    last_visited_at: row.last_visited_at,
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  agents: [],
  currentProjectId: null,
  isDrawerPinned: readDrawerPinned(),
  sessionViewMode: readSessionViewMode(),

  fetchProjects: async () => {
    try {
      const data = (await wsClient.request({ type: 'projects.list' })) as ProjectRow[]
      set({ projects: data.map(mapProjectRow) })
    } catch {
      /* ignore */
    }
  },

  fetchAgents: async (projectId?: string) => {
    try {
      // 后端 agents.list 不过滤隐藏 Agent(PC 端在 Workspace 过滤);APP 没有恢复入口,直接在数据层排除
      const data = (await wsClient.request({ type: 'agents.list', projectId })) as AgentItem[]
      set({ agents: data.filter((agent) => !agent.hidden_at) })
    } catch {
      /* ignore */
    }
  },

  setCurrentProject: (id) => set({ currentProjectId: id }),

  setDrawerPinned: (value) => {
    writeDrawerPinned(value)
    set({ isDrawerPinned: value })
  },

  setSessionViewMode: (mode) => {
    writeSessionViewMode(mode)
    set({ sessionViewMode: mode })
  },

  createProject: async (input) => {
    const row = (await wsClient.request({
      type: 'projects.create',
      name: input.name,
      workDir: input.workDir ?? '',
      description: input.description,
      color: input.color,
      icon: input.icon,
    })) as ProjectRow
    await get().fetchProjects()
    return row
  },
}))
