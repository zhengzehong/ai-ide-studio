import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'

export interface ProjectItem {
  id: string
  name: string
  work_dir?: string
  path?: string
  description?: string | null
  color?: string | null
  icon?: string | null
  last_visited_at?: string | null
}

interface AgentItem {
  id: string
  name: string
  type?: string
  model?: string
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

interface AppState {
  projects: ProjectItem[]
  agents: AgentItem[]
  currentProjectId: string | null
  isDrawerPinned: boolean
  fetchProjects: () => Promise<void>
  fetchAgents: () => Promise<void>
  setCurrentProject: (id: string | null) => void
  setDrawerPinned: (value: boolean) => void
  createProject: (input: CreateProjectInput) => Promise<ProjectRow>
}

function mapProjectRow(row: ProjectRow): ProjectItem {
  return {
    id: row.id,
    name: row.name,
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

  fetchProjects: async () => {
    try {
      const data = (await wsClient.request({ type: 'projects.list' })) as ProjectRow[]
      set({ projects: data.map(mapProjectRow) })
    } catch {
      /* ignore */
    }
  },

  fetchAgents: async () => {
    try {
      const data = (await wsClient.request({ type: 'agents.list' })) as AgentItem[]
      set({ agents: data })
    } catch {
      /* ignore */
    }
  },

  setCurrentProject: (id) => set({ currentProjectId: id }),

  setDrawerPinned: (value) => {
    writeDrawerPinned(value)
    set({ isDrawerPinned: value })
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
