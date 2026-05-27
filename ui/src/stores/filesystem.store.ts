import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

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

interface FileSystemStore {
  tree: FileEntry[]
  openFile: FileContent | null
  loading: boolean
  loadingFile: boolean

  fetchTree: (projectId: string) => Promise<void>
  expandDir: (projectId: string, dirPath: string) => Promise<void>
  openFileByPath: (projectId: string, filePath: string) => Promise<void>
  closeFile: () => void
  reset: () => void
}

export const useFileSystemStore = create<FileSystemStore>((set, get) => ({
  tree: [],
  openFile: null,
  loading: false,
  loadingFile: false,

  fetchTree: async (projectId) => {
    set({ loading: true })
    try {
      const data = (await wsClient.request({ type: 'fs.list', projectId })) as FileEntry[]
      set({ tree: data, loading: false })
    } catch {
      set({ loading: false })
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

      set({ tree: updateChildren(get().tree) })
    } catch {
      // ignore expand failure
    }
  },

  openFileByPath: async (projectId, filePath) => {
    set({ loadingFile: true })
    try {
      const data = (await wsClient.request({
        type: 'fs.read',
        projectId,
        filePath,
      })) as FileContent
      set({ openFile: data, loadingFile: false })
    } catch {
      set({ loadingFile: false })
    }
  },

  closeFile: () => set({ openFile: null }),
  reset: () => set({ tree: [], openFile: null }),
}))
