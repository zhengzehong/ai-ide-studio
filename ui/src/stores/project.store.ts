import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

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
      set({ projects: data, loading: false })
      if (data.length > 0 && !get().currentProjectId) {
        set({ currentProjectId: data[0].id })
      }
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
    }
    return project
  },

  selectProject: (id) => {
    set({ currentProjectId: id })
  },

  deleteProject: async (id) => {
    await wsClient.request({ type: 'projects.delete', projectId: id })
    const remaining = get().projects.filter((p) => p.id !== id)
    set({
      projects: remaining,
      currentProjectId: get().currentProjectId === id ? (remaining[0]?.id ?? null) : get().currentProjectId,
    })
  },

  currentProject: () => {
    const { projects, currentProjectId } = get()
    return projects.find((p) => p.id === currentProjectId)
  },
}))
