import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import {
  beginProjectRequest,
  clearProjectCache,
  commitProjectResponse,
  emptyProjectCache,
  invalidateProjectCache,
  pruneProjectCache,
  readProjectCache,
  shouldRefreshProjectCache,
  touchProjectCache,
  type ProjectCacheState,
} from './project-cache'

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  extension?: string
  children?: FileEntry[]
}

export interface FileContent {
  path: string
  content: string
  size: number
  extension: string
  language: string
  truncated: boolean
}

export interface FileSystemProjectSnapshot {
  tree: FileEntry[]
  openFile: FileContent | null
}

interface FileSystemStore {
  tree: FileEntry[]
  openFile: FileContent | null
  loading: boolean
  loadingFile: boolean
  activeProjectId: string | null
  projectCache: ProjectCacheState<FileSystemProjectSnapshot>

  activateProject: (projectId: string) => void
  fetchTree: (projectId: string, options?: { force?: boolean }) => Promise<void>
  expandDir: (projectId: string, dirPath: string) => Promise<void>
  openFileByPath: (projectId: string, filePath: string) => Promise<void>
  closeFile: () => void
  invalidateProject: (projectId: string) => void
  clearProjectCache: (projectId: string) => void
  reset: () => void
}

const treeFetches = new Map<string, Promise<void>>()
const fileRequestSeq = new Map<string, number>()

function updateSnapshot(
  cache: ProjectCacheState<FileSystemProjectSnapshot>,
  projectId: string,
  patch: Partial<FileSystemProjectSnapshot>,
): ProjectCacheState<FileSystemProjectSnapshot> {
  const current = cache.entries[projectId]
  const now = Date.now()
  return {
    ...cache,
    entries: {
      ...cache.entries,
      [projectId]: {
        data: { ...(current?.data ?? { tree: [], openFile: null }), ...patch },
        fetchedAt: current?.fetchedAt ?? now,
        lastAccessedAt: now,
        invalidated: false,
        error: null,
      },
    },
  }
}

export const useFileSystemStore = create<FileSystemStore>((set, get) => ({
  tree: [],
  openFile: null,
  loading: false,
  loadingFile: false,
  activeProjectId: null,
  projectCache: emptyProjectCache<FileSystemProjectSnapshot>(),

  activateProject: (projectId) => {
    set((state) => {
      const projectCache = pruneProjectCache(touchProjectCache(state.projectCache, projectId), projectId)
      const snapshot = readProjectCache(projectCache, projectId)?.data
      return {
        activeProjectId: projectId,
        projectCache,
        tree: snapshot?.tree ?? [],
        openFile: snapshot?.openFile ?? null,
        loading: false,
        loadingFile: false,
      }
    })
  },

  fetchTree: async (projectId, options) => {
    const cached = readProjectCache(get().projectCache, projectId)
    if (!options?.force && cached && !shouldRefreshProjectCache(cached)) return
    const inFlight = treeFetches.get(projectId)
    if (!options?.force && inFlight) return inFlight
    let requestSeq = 0
    set((state) => {
      const request = beginProjectRequest(state.projectCache, projectId)
      requestSeq = request.requestSeq
      return {
        projectCache: request.state,
        loading: state.activeProjectId === projectId && !cached,
      }
    })
    const request = (async (): Promise<void> => {
    try {
      const data = (await wsClient.request({ type: 'fs.list', projectId })) as FileEntry[]
        set((state) => {
          const current = readProjectCache(state.projectCache, projectId)?.data
          const projectCache = pruneProjectCache(commitProjectResponse(state.projectCache, {
            scope: projectId,
            requestSeq,
            data: { tree: data, openFile: current?.openFile ?? null },
          }), state.activeProjectId ?? projectId)
          return {
            projectCache,
            tree: state.activeProjectId === projectId ? data : state.tree,
            loading: state.activeProjectId === projectId ? false : state.loading,
          }
        })
    } catch {
        if (get().activeProjectId === projectId) set({ loading: false })
    }
    })()
    treeFetches.set(projectId, request)
    try {
      await request
    } finally {
      if (treeFetches.get(projectId) === request) treeFetches.delete(projectId)
    }
  },

  expandDir: async (projectId, dirPath) => {
    try {
      const children = (await wsClient.request({
        type: 'fs.list',
        projectId,
        dirPath,
      })) as FileEntry[]

      const updateChildren = (entries: FileEntry[]): FileEntry[] =>
        entries.map((e) => {
          if (e.path === dirPath && e.type === 'directory') {
            return { ...e, children }
          }
          if (e.children) {
            return { ...e, children: updateChildren(e.children) }
          }
          return e
        })

      set((state) => {
        const source = readProjectCache(state.projectCache, projectId)?.data.tree
          ?? (state.activeProjectId === projectId ? state.tree : [])
        const tree = updateChildren(source)
        return {
          projectCache: updateSnapshot(state.projectCache, projectId, { tree }),
          tree: state.activeProjectId === projectId ? tree : state.tree,
        }
      })
    } catch {
      // ignore expand failure
    }
  },

  openFileByPath: async (projectId, filePath) => {
    const requestSeq = (fileRequestSeq.get(projectId) ?? 0) + 1
    fileRequestSeq.set(projectId, requestSeq)
    if (get().activeProjectId === projectId) set({ loadingFile: true })
    try {
      const data = (await wsClient.request({
        type: 'fs.read',
        projectId,
        filePath,
      })) as FileContent
      if (fileRequestSeq.get(projectId) !== requestSeq) return
      set((state) => ({
        projectCache: updateSnapshot(state.projectCache, projectId, { openFile: data }),
        openFile: state.activeProjectId === projectId ? data : state.openFile,
        loadingFile: state.activeProjectId === projectId ? false : state.loadingFile,
      }))
    } catch {
      if (get().activeProjectId === projectId) set({ loadingFile: false })
    }
  },

  closeFile: () => set((state) => ({
    projectCache: state.activeProjectId
      ? updateSnapshot(state.projectCache, state.activeProjectId, { openFile: null })
      : state.projectCache,
    openFile: null,
  })),
  invalidateProject: (projectId) => set((state) => ({
    projectCache: invalidateProjectCache(state.projectCache, projectId),
  })),
  clearProjectCache: (projectId) => set((state) => ({
    projectCache: clearProjectCache(state.projectCache, projectId),
  })),
  reset: () => set({
    tree: [],
    openFile: null,
    activeProjectId: null,
    projectCache: emptyProjectCache<FileSystemProjectSnapshot>(),
  }),
}))
