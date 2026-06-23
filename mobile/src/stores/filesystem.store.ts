import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'

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

interface FileSystemState {
  projectId: string | null
  tree: FileEntry[]
  openFile: FileContent | null
  loading: boolean
  loadingFile: boolean
  error: string | null

  initTree: (projectId: string) => Promise<void>
  expandDir: (dirPath: string) => Promise<void>
  openFileByPath: (filePath: string) => Promise<void>
  closeFile: () => void
  reset: () => void
}

function mergeChildren(tree: FileEntry[], dirPath: string, children: FileEntry[]): FileEntry[] {
  return tree.map((entry) => {
    if (entry.path === dirPath && entry.type === 'directory') {
      return { ...entry, children }
    }
    if (entry.children) {
      return { ...entry, children: mergeChildren(entry.children, dirPath, children) }
    }
    return entry
  })
}

export const useFileSystemStore = create<FileSystemState>((set, get) => ({
  projectId: null,
  tree: [],
  openFile: null,
  loading: false,
  loadingFile: false,
  error: null,

  initTree: async (projectId) => {
    if (get().projectId === projectId && get().tree.length > 0) return
    set({ projectId, loading: true, error: null, tree: [], openFile: null })
    try {
      const data = (await wsClient.request({ type: 'fs.list', projectId })) as FileEntry[]
      set({ tree: data, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '加载目录失败' })
    }
  },

  expandDir: async (dirPath) => {
    const pid = get().projectId
    if (!pid) return
    try {
      const children = (await wsClient.request({
        type: 'fs.list',
        projectId: pid,
        dirPath,
      })) as FileEntry[]
      set({ tree: mergeChildren(get().tree, dirPath, children) })
    } catch {
      // ignore expand failure
    }
  },

  openFileByPath: async (filePath) => {
    const pid = get().projectId
    if (!pid) return
    set({ loadingFile: true, openFile: null, error: null })
    try {
      const data = (await wsClient.request({
        type: 'fs.read',
        projectId: pid,
        filePath,
      })) as FileContent
      set({ openFile: data, loadingFile: false })
    } catch (err) {
      set({ loadingFile: false, error: err instanceof Error ? err.message : '读取文件失败' })
    }
  },

  closeFile: () => set({ openFile: null, error: null }),

  reset: () => set({ projectId: null, tree: [], openFile: null, loading: false, loadingFile: false, error: null }),
}))
