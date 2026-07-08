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
  color: string | null
  icon: string | null
  last_visited_at: string | null
  visit_count: number
}

interface ProjectStore {
  projects: ProjectData[]
  currentProjectId: string | null
  previousProjectId: string | null
  loading: boolean
  fetchProjects: () => Promise<void>
  createProject: (input: {
    name: string
    workDir: string
    description?: string
    color?: string
    icon?: string
  }) => Promise<ProjectData>
  selectProject: (id: string | null) => void
  deleteProject: (id: string) => Promise<void>
  updateProject: (id: string, fields: {
    name?: string
    workDir?: string
    description?: string
    color?: string
    icon?: string
  }) => Promise<ProjectData | undefined>
  currentProject: () => ProjectData | undefined
  recentPaths: () => string[]
  checkPath: (path: string) => Promise<{ exists: boolean; isDir: boolean }>
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProjectId: null,
  previousProjectId: null,
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

  createProject: async (input) => {
    const project = (await wsClient.request({
      type: 'projects.create',
      name: input.name,
      workDir: input.workDir,
      description: input.description,
      color: input.color,
      icon: input.icon,
    })) as ProjectData
    set({ projects: [...get().projects, project] })
    if (!get().currentProjectId) {
      set({ currentProjectId: project.id })
      writeStoredProjectId(project.id)
    }
    return project
  },

  updateProject: async (id, fields) => {
    const msg: Record<string, unknown> = { type: 'projects.update', projectId: id }
    if (fields.name !== undefined) msg.name = fields.name
    if (fields.workDir !== undefined) msg.workDir = fields.workDir
    if (fields.description !== undefined) msg.description = fields.description
    if (fields.color !== undefined) msg.color = fields.color
    if (fields.icon !== undefined) msg.icon = fields.icon
    const updated = (await wsClient.request(msg)) as ProjectData
    set({ projects: get().projects.map((p) => (p.id === id ? updated : p)) })
    return updated
  },

  selectProject: (id) => {
    const prev = get().currentProjectId
    if (prev === id) return
    set({ previousProjectId: prev, currentProjectId: id })
    writeStoredProjectId(id)
    if (id) {
      void wsClient
        .request({ type: 'projects.select', projectId: id })
        .then((touched) => {
          if (touched) {
            set({
              projects: get().projects.map((p) => (p.id === id ? (touched as ProjectData) : p)),
            })
          }
        })
        .catch(() => {
          // ignore — visit tracking is best-effort
        })
    }
  },

  deleteProject: async (id) => {
    await wsClient.request({ type: 'projects.delete', projectId: id })
    const remaining = get().projects.filter((p) => p.id !== id)
    const nextProjectId = get().currentProjectId === id ? (remaining[0]?.id ?? null) : get().currentProjectId
    set({
      projects: remaining,
      currentProjectId: nextProjectId,
      previousProjectId: get().previousProjectId === id ? null : get().previousProjectId,
    })
    writeStoredProjectId(nextProjectId)
  },

  currentProject: () => {
    const { projects, currentProjectId } = get()
    return projects.find((p) => p.id === currentProjectId)
  },

  recentPaths: () => {
    const { projects } = get()
    const seen = new Set<string>()
    const sorted = [...projects].sort((a, b) => {
      const at = a.last_visited_at ? Date.parse(a.last_visited_at) : 0
      const bt = b.last_visited_at ? Date.parse(b.last_visited_at) : 0
      return bt - at
    })
    const result: string[] = []
    for (const p of sorted) {
      const path = p.work_dir?.trim()
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      result.push(path)
      if (result.length >= 5) break
    }
    return result
  },

  checkPath: async (path: string) => {
    try {
      return (await wsClient.request({ type: 'projects.check_path', path })) as { exists: boolean; isDir: boolean }
    } catch {
      return { exists: false, isDir: false }
    }
  },
}))
