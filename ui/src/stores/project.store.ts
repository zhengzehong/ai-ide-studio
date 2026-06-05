import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

const CURRENT_PROJECT_STORAGE_KEY = 'ai-ide-current-project-id'

function localStorageRef(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readStoredProjectId(): string | null {
  return localStorageRef()?.getItem(CURRENT_PROJECT_STORAGE_KEY) ?? null
}

function writeStoredProjectId(projectId: string | null): void {
  const storage = localStorageRef()
  if (!storage) return
  if (projectId) storage.setItem(CURRENT_PROJECT_STORAGE_KEY, projectId)
  else storage.removeItem(CURRENT_PROJECT_STORAGE_KEY)
}

export interface ProjectData {
  id: string
  name: string
  work_dir: string
  description: string | null
  created_at: string
  updated_at: string
}

interface ProjectStore {
  projects: ProjectData[]
  currentProjectId: string | null
  loading: boolean
  fetchProjects: () => Promise<void>
  createProject: (name: string, workDir: string, description?: string) => Promise<ProjectData>
  selectProject: (id: string | null) => void
  deleteProject: (id: string) => Promise<void>
  currentProject: () => ProjectData | undefined
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProjectId: null,
  loading: false,

  fetchProjects: async () => {
    set({ loading: true })
    try {
      const data = (await wsClient.request({ type: 'projects.list' })) as ProjectData[]
      const currentProjectId = get().currentProjectId
      const storedProjectId = readStoredProjectId()
      const nextProjectId =
        (currentProjectId && data.some((project) => project.id === currentProjectId) ? currentProjectId : null)
        ?? (storedProjectId && data.some((project) => project.id === storedProjectId) ? storedProjectId : null)
        ?? data[0]?.id
        ?? null
      set({ projects: data, currentProjectId: nextProjectId, loading: false })
      writeStoredProjectId(nextProjectId)
    } catch {
      set({ loading: false })
    }
  },

  createProject: async (name, workDir, description) => {
    const project = (await wsClient.request({
      type: 'projects.create',
      name,
      workDir,
      description,
    })) as ProjectData
    set({ projects: [...get().projects, project] })
    if (!get().currentProjectId) {
      set({ currentProjectId: project.id })
      writeStoredProjectId(project.id)
    }
    return project
  },

  selectProject: (id) => {
    set({ currentProjectId: id })
    writeStoredProjectId(id)
  },

  deleteProject: async (id) => {
    await wsClient.request({ type: 'projects.delete', projectId: id })
    const remaining = get().projects.filter((p) => p.id !== id)
    const nextProjectId = get().currentProjectId === id ? (remaining[0]?.id ?? null) : get().currentProjectId
    set({
      projects: remaining,
      currentProjectId: nextProjectId,
    })
    writeStoredProjectId(nextProjectId)
  },

  currentProject: () => {
    const { projects, currentProjectId } = get()
    return projects.find((p) => p.id === currentProjectId)
  },
}))
