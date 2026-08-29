import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'
import type { InspirationConfig, InspirationNote } from '@desktop/stores/inspiration.store'

export interface ProjectInspiration {
  notes: InspirationNote[]
  config: InspirationConfig | null
  loaded: boolean
}

interface InspirationState {
  byProject: Record<string, ProjectInspiration>
  loading: boolean
  error: string | null
  load: (projectId: string | null, options?: { silent?: boolean }) => Promise<void>
  saveNote: (projectId: string, sourceMarkdown: string) => Promise<InspirationNote>
  removeNote: (projectId: string, noteId: string) => Promise<void>
  setCompleted: (projectId: string, noteId: string, completed: boolean) => Promise<void>
  organize: (projectId: string, noteId: string) => Promise<void>
  createCandidateTask: (projectId: string, candidateId: string, agentId: string, sessionId: string, execute: boolean) => Promise<InspirationNote>
  setupListeners: () => () => void
}

let loadSequence = 0

function sortNotes(notes: InspirationNote[]): InspirationNote[] {
  return notes.slice().sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt).getTime()
    const tb = new Date(b.updatedAt || b.createdAt).getTime()
    return tb - ta
  })
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function patchNote(
  set: (partial: (state: InspirationState) => Partial<InspirationState>) => void,
  projectId: string,
  note: InspirationNote,
): void {
  set((state) => {
    const entry = state.byProject[projectId]
    if (!entry) return state
    return {
      byProject: {
        ...state.byProject,
        [projectId]: { ...entry, notes: entry.notes.map((item) => (item.id === note.id ? note : item)) },
      },
    }
  })
}

export const useInspirationStore = create<InspirationState>((set, get) => ({
  byProject: {},
  loading: false,
  error: null,

  load: async (projectId, options) => {
    if (!projectId) return
    const sequence = ++loadSequence
    if (!options?.silent) set({ loading: true, error: null })
    try {
      const data = (await wsClient.request({ type: 'inspiration.get', projectId })) as {
        config: InspirationConfig
        notes: InspirationNote[]
      }
      if (sequence !== loadSequence) return
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: { notes: sortNotes(data.notes), config: data.config, loaded: true },
        },
        loading: false,
        error: null,
      }))
    } catch (error) {
      if (sequence !== loadSequence) return
      set({ loading: false, error: errorText(error, '灵感加载失败') })
    }
  },

  saveNote: async (projectId, sourceMarkdown) => {
    const note = (await wsClient.request({
      type: 'inspiration.note.create',
      projectId,
      titleMode: 'auto',
      sourceMarkdown,
    })) as InspirationNote
    set((state) => {
      const entry = state.byProject[projectId]
      if (!entry) return state
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...entry, notes: sortNotes([note, ...entry.notes]) },
        },
      }
    })
    return note
  },

  removeNote: async (projectId, noteId) => {
    await wsClient.request({ type: 'inspiration.note.delete', projectId, noteId })
    set((state) => {
      const entry = state.byProject[projectId]
      if (!entry) return state
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...entry, notes: entry.notes.filter((item) => item.id !== noteId) },
        },
      }
    })
  },

  setCompleted: async (projectId, noteId, completed) => {
    const note = (await wsClient.request({
      type: 'inspiration.note.setCompleted',
      projectId,
      noteId,
      completed,
    })) as InspirationNote
    patchNote(set, projectId, note)
  },

  organize: async (projectId, noteId) => {
    const note = (await wsClient.request({
      type: 'inspiration.note.organize',
      projectId,
      noteId,
    })) as InspirationNote
    patchNote(set, projectId, note)
  },

  createCandidateTask: async (projectId, candidateId, agentId, sessionId, execute) => {
    // 会话选择对齐 PC:选了具体会话走 existing,否则每次新建独立会话
    const note = (await wsClient.request({
      type: 'inspiration.candidate.createTask',
      projectId,
      candidateId,
      agentId,
      execute,
      ...(sessionId ? { sessionId, sessionMode: 'existing' } : { sessionMode: 'new_each' }),
    })) as InspirationNote
    patchNote(set, projectId, note)
    return note
  },

  setupListeners: () => {
    const offUpdate = wsClient.on('inspiration:update', (event) => {
      const projectId = typeof event.projectId === 'string' ? event.projectId : ''
      if (projectId && get().byProject[projectId]) void get().load(projectId, { silent: true })
    })
    const offReconnect = wsClient.on('reconnected', () => {
      for (const projectId of Object.keys(get().byProject)) {
        void get().load(projectId, { silent: true })
      }
    })
    return () => {
      offUpdate()
      offReconnect()
    }
  },
}))
