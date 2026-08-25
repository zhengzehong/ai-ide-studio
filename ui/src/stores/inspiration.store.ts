import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import type { ImageAttachmentInfo } from './session-events'

export interface InspirationConfig {
  projectId: string
  sessionId: string | null
  organizerAgentId: string | null
  organizationPrompt: string
  autoOrganize: boolean
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface InspirationCandidate {
  id: string
  noteId: string
  analysisRevision: number
  sortOrder: number
  title: string
  descriptionMarkdown: string
  suggestedAgentId: string | null
  suggestedAgentName: string | null
  agentReason: string
  taskId: string | null
  taskStatus: string | null
  executionSessionId: string | null
}

export interface InspirationNote {
  id: string
  projectId: string
  title: string
  titleMode: 'auto' | 'manual'
  sourceMarkdown: string
  attachments: ImageAttachmentInfo[]
  status: 'draft' | 'queued' | 'processing' | 'ready' | 'needs_input' | 'failed'
  analysisRevision: number
  summary: string
  bodyMarkdown: string
  questions: string[]
  lastError: string | null
  createdAt: string
  updatedAt: string
  organizedAt: string | null
  candidates: InspirationCandidate[]
}

export interface PendingInspirationImage {
  data: string
  mimeType: string
  name?: string
}

interface InspirationState {
  projectId: string | null
  config: InspirationConfig | null
  notes: InspirationNote[]
  selectedId: string | null
  loading: boolean
  saving: boolean
  error: string | null
  load: (projectId: string, silent?: boolean) => Promise<void>
  select: (noteId: string | null) => void
  saveNote: (input: {
    noteId?: string
    title: string
    titleMode: 'auto' | 'manual'
    sourceMarkdown: string
    keepAttachmentPaths?: string[]
    images?: PendingInspirationImage[]
  }) => Promise<InspirationNote>
  removeNote: (noteId: string) => Promise<void>
  organize: (noteId: string) => Promise<void>
  configure: (input: { organizerAgentId: string; organizationPrompt: string; autoOrganize: boolean }) => Promise<void>
  rebuildSession: (organizerAgentId: string) => Promise<void>
  updateCandidate: (candidateId: string, input: { title: string; descriptionMarkdown: string; suggestedAgentId: string | null }) => Promise<void>
  createCandidateTask: (candidateId: string, agentId: string, execute: boolean) => Promise<InspirationNote>
  setupListeners: () => () => void
}

let loadSequence = 0

export const useInspirationStore = create<InspirationState>((set, get) => ({
  projectId: null,
  config: null,
  notes: [],
  selectedId: null,
  loading: false,
  saving: false,
  error: null,

  load: async (projectId, silent = false) => {
    const sequence = ++loadSequence
    if (!silent) set({ projectId, loading: true, error: null })
    try {
      const data = await wsClient.request({ type: 'inspiration.get', projectId }) as {
        config: InspirationConfig
        notes: InspirationNote[]
      }
      if (sequence !== loadSequence) return
      const currentSelected = get().projectId === projectId ? get().selectedId : null
      const selectedId = currentSelected && data.notes.some((note) => note.id === currentSelected)
        ? currentSelected
        : data.notes[0]?.id ?? null
      set({ projectId, config: data.config, notes: data.notes, selectedId, loading: false, error: null })
    } catch (error) {
      if (sequence !== loadSequence) return
      set({ loading: false, error: message(error, '灵感加载失败') })
    }
  },

  select: (selectedId) => set({ selectedId }),

  saveNote: async (input) => {
    const projectId = requireProject(get().projectId)
    set({ saving: true, error: null })
    try {
      const type = input.noteId ? 'inspiration.note.update' : 'inspiration.note.create'
      const note = await wsClient.request({ type, projectId, ...input }) as InspirationNote
      set((state) => ({
        saving: false,
        selectedId: note.id,
        notes: input.noteId
          ? state.notes.map((item) => item.id === note.id ? note : item)
          : [note, ...state.notes],
      }))
      return note
    } catch (error) {
      set({ saving: false, error: message(error, '灵感保存失败') })
      throw error
    }
  },

  removeNote: async (noteId) => {
    const projectId = requireProject(get().projectId)
    await wsClient.request({ type: 'inspiration.note.delete', projectId, noteId })
    set((state) => {
      const notes = state.notes.filter((note) => note.id !== noteId)
      return { notes, selectedId: state.selectedId === noteId ? notes[0]?.id ?? null : state.selectedId }
    })
  },

  organize: async (noteId) => {
    const projectId = requireProject(get().projectId)
    const note = await wsClient.request({ type: 'inspiration.note.organize', projectId, noteId }) as InspirationNote
    patchNote(set, note)
  },

  configure: async (input) => {
    const projectId = requireProject(get().projectId)
    set({ saving: true, error: null })
    try {
      const config = await wsClient.request({ type: 'inspiration.configure', projectId, ...input }) as InspirationConfig
      set({ config, saving: false })
    } catch (error) {
      set({ saving: false, error: message(error, '灵感设置保存失败') })
      throw error
    }
  },

  rebuildSession: async (organizerAgentId) => {
    const projectId = requireProject(get().projectId)
    const config = await wsClient.request({
      type: 'inspiration.session.rebuild', projectId, organizerAgentId,
    }) as InspirationConfig
    set({ config })
  },

  updateCandidate: async (candidateId, input) => {
    const projectId = requireProject(get().projectId)
    const note = await wsClient.request({
      type: 'inspiration.candidate.update', projectId, candidateId, ...input,
    }) as InspirationNote
    patchNote(set, note)
  },

  createCandidateTask: async (candidateId, agentId, execute) => {
    const projectId = requireProject(get().projectId)
    const note = await wsClient.request({
      type: 'inspiration.candidate.createTask', projectId, candidateId, agentId, execute,
    }) as InspirationNote
    patchNote(set, note)
    return note
  },

  setupListeners: () => {
    const refresh = (): void => {
      const projectId = get().projectId
      if (projectId) void get().load(projectId, true)
    }
    const offUpdate = wsClient.on('inspiration:update', (event) => {
      if (event.projectId === get().projectId) refresh()
    })
    const offReconnect = wsClient.on('reconnected', refresh)
    return () => { offUpdate(); offReconnect() }
  },
}))

function patchNote(
  set: (partial: Partial<InspirationState> | ((state: InspirationState) => Partial<InspirationState>)) => void,
  note: InspirationNote,
): void {
  set((state) => ({ notes: state.notes.map((item) => item.id === note.id ? note : item) }))
}

function requireProject(projectId: string | null): string {
  if (!projectId) throw new Error('未选择项目')
  return projectId
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
