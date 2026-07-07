import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface AgentMemoryDimensionData {
  id: string
  project_id: string
  agent_id: string
  name: string
  description: string | null
  prompt: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface AgentMemoryEntrySummary {
  id: string
  title: string
  preview: string
  tags: string[]
  use_count: number
  last_used_at: string | null
  pinned: boolean
  matched_keywords?: string[]
}

export interface AgentMemoryEntryFull {
  id: string
  dimension_id: string
  dimension_name: string
  title: string
  content: string
  tags: string[]
  source_session_id: string | null
  source_task_id: string | null
  confidence: number
  pinned: boolean
  use_count: number
  last_used_at: string | null
  created_at: string
}

interface AgentMemoryStore {
  dimensions: AgentMemoryDimensionData[]
  entries: AgentMemoryEntrySummary[]
  currentEntry: AgentMemoryEntryFull | null
  pinnedLimit: number
  loading: boolean
  saving: boolean
  error: string | null
  fetchEntriesSeq: number
  clearError: () => void
  fetchDimensions: (projectId: string, agentId: string) => Promise<void>
  createDimension: (projectId: string, agentId: string, input: { name: string; description?: string | null; prompt?: string | null }) => Promise<AgentMemoryDimensionData>
  updateDimension: (projectId: string, agentId: string, dimensionId: string, input: { name?: string; description?: string | null; prompt?: string | null }) => Promise<AgentMemoryDimensionData>
  deleteDimension: (projectId: string, agentId: string, dimensionId: string) => Promise<void>
  fetchEntries: (projectId: string, agentId: string, dimension: string) => Promise<void>
  getEntry: (projectId: string, agentId: string, entryId: string) => Promise<AgentMemoryEntryFull>
  createEntry: (projectId: string, agentId: string, input: { dimension: string; title: string; content: string; tags?: string[]; confidence?: number }) => Promise<AgentMemoryEntryFull>
  updateEntry: (projectId: string, agentId: string, entryId: string, input: { title?: string; content?: string; tags?: string[]; confidence?: number; pinned?: boolean }) => Promise<AgentMemoryEntryFull>
  deleteEntry: (projectId: string, agentId: string, entryId: string) => Promise<void>
  recall: (projectId: string, agentId: string, dimension: string, keywords: string[], limit?: number) => Promise<AgentMemoryEntrySummary[]>
}

export const useAgentMemoryStore = create<AgentMemoryStore>((set, get) => ({
  dimensions: [],
  entries: [],
  currentEntry: null,
  pinnedLimit: 20,
  loading: false,
  saving: false,
  error: null,
  fetchEntriesSeq: 0,
  clearError: () => set({ error: null }),

  fetchDimensions: async (projectId, agentId) => {
    set({ loading: true, error: null })
    try {
      const data = await wsClient.request({ type: 'agentMemory.dimensions.list', projectId, agentId }) as { dimensions: AgentMemoryDimensionData[] }
      set({ dimensions: data.dimensions, loading: false })
    } catch (err) {
      set({ loading: false, error: errorMessage(err) })
    }
  },

  createDimension: async (projectId, agentId, input) => {
    set({ saving: true, error: null })
    try {
      const data = await wsClient.request({ type: 'agentMemory.dimensions.create', projectId, agentId, ...input }) as { dimension: AgentMemoryDimensionData }
      set({ saving: false })
      await get().fetchDimensions(projectId, agentId)
      return data.dimension
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  updateDimension: async (projectId, agentId, dimensionId, input) => {
    set({ saving: true, error: null })
    try {
      const data = await wsClient.request({ type: 'agentMemory.dimensions.update', projectId, agentId, dimensionId, ...input }) as { dimension: AgentMemoryDimensionData }
      set({ saving: false })
      await get().fetchDimensions(projectId, agentId)
      return data.dimension
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  deleteDimension: async (projectId, agentId, dimensionId) => {
    set({ saving: true, error: null })
    try {
      await wsClient.request({ type: 'agentMemory.dimensions.delete', projectId, agentId, dimensionId })
      set({ saving: false })
      await get().fetchDimensions(projectId, agentId)
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  fetchEntries: async (projectId, agentId, dimension) => {
    const seq = get().fetchEntriesSeq + 1
    set({ loading: true, error: null, fetchEntriesSeq: seq })
    try {
      const data = await wsClient.request({ type: 'agentMemory.entries.list', projectId, agentId, dimension }) as { entries: AgentMemoryEntrySummary[]; pinnedLimit: number }
      if (seq !== get().fetchEntriesSeq) return
      set({ entries: data.entries, pinnedLimit: data.pinnedLimit ?? 20, loading: false })
    } catch (err) {
      if (seq !== get().fetchEntriesSeq) return
      set({ loading: false, error: errorMessage(err) })
    }
  },

  getEntry: async (projectId, agentId, entryId) => {
    const data = await wsClient.request({ type: 'agentMemory.entries.get', projectId, agentId, entryId }) as { entry: AgentMemoryEntryFull }
    set({ currentEntry: data.entry })
    return data.entry
  },

  createEntry: async (projectId, agentId, input) => {
    set({ saving: true, error: null })
    try {
      const data = await wsClient.request({ type: 'agentMemory.entries.create', projectId, agentId, ...input }) as { entry: AgentMemoryEntryFull }
      set({ saving: false })
      return data.entry
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  updateEntry: async (projectId, agentId, entryId, input) => {
    set({ saving: true, error: null })
    try {
      const data = await wsClient.request({ type: 'agentMemory.entries.update', projectId, agentId, entryId, ...input }) as { entry: AgentMemoryEntryFull }
      set({ saving: false })
      return data.entry
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  deleteEntry: async (projectId, agentId, entryId) => {
    set({ saving: true, error: null })
    try {
      await wsClient.request({ type: 'agentMemory.entries.delete', projectId, agentId, entryId })
      set({ saving: false })
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  recall: async (projectId, agentId, dimension, keywords, limit) => {
    const data = await wsClient.request({ type: 'agentMemory.entries.recall', projectId, agentId, dimension, keywords, limit }) as { entries: AgentMemoryEntrySummary[] }
    return data.entries
  },
}))

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return '操作失败'
}
