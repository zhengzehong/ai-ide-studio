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
  inject_full: boolean
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
  inject_full: boolean
  use_count: number
  last_used_at: string | null
  created_at: string
}

export interface AgentMemoryEntriesSnapshot {
  entries: AgentMemoryEntrySummary[]
  pinnedLimit: number
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
  activeDimensionScope: string | null
  activeEntryScope: string | null
  dimensionCache: ProjectCacheState<AgentMemoryDimensionData[]>
  entryCache: ProjectCacheState<AgentMemoryEntriesSnapshot>
  activateScope: (projectId: string, agentId?: string | null, dimension?: string | null) => void
  invalidateProject: (projectId: string) => void
  clearProjectCache: (projectId: string) => void
  clearError: () => void
  fetchDimensions: (projectId: string, agentId: string, options?: { force?: boolean }) => Promise<void>
  createDimension: (projectId: string, agentId: string, input: { name: string; description?: string | null; prompt?: string | null }) => Promise<AgentMemoryDimensionData>
  updateDimension: (projectId: string, agentId: string, dimensionId: string, input: { name?: string; description?: string | null; prompt?: string | null }) => Promise<AgentMemoryDimensionData>
  deleteDimension: (projectId: string, agentId: string, dimensionId: string) => Promise<void>
  fetchEntries: (
    projectId: string,
    agentId: string,
    dimension: string,
    options?: { force?: boolean },
  ) => Promise<void>
  getEntry: (projectId: string, agentId: string, entryId: string) => Promise<AgentMemoryEntryFull>
  createEntry: (projectId: string, agentId: string, input: { dimension: string; title: string; content: string; tags?: string[]; confidence?: number }) => Promise<AgentMemoryEntryFull>
  updateEntry: (projectId: string, agentId: string, entryId: string, input: { title?: string; content?: string; tags?: string[]; confidence?: number; pinned?: boolean; injectFull?: boolean }) => Promise<AgentMemoryEntryFull>
  deleteEntry: (projectId: string, agentId: string, entryId: string) => Promise<void>
  recall: (projectId: string, agentId: string, dimension: string, keywords: string[], limit?: number) => Promise<AgentMemoryEntrySummary[]>
}

function dimensionScope(projectId: string, agentId: string): string {
  return `${projectId}:${agentId}`
}

function entryScope(projectId: string, agentId: string, dimension: string): string {
  return `${projectId}:${agentId}:${dimension}`
}

function mutateProjectScopes<T>(
  cache: ProjectCacheState<T>,
  projectId: string,
  action: (state: ProjectCacheState<T>, scope: string) => ProjectCacheState<T>,
): ProjectCacheState<T> {
  return [
    ...Object.keys(cache.entries),
    ...Object.keys(cache.requestSeqByScope),
  ]
    .filter((scope, index, scopes) => scopes.indexOf(scope) === index && scope.startsWith(`${projectId}:`))
    .reduce(action, cache)
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
  activeDimensionScope: null,
  activeEntryScope: null,
  dimensionCache: emptyProjectCache<AgentMemoryDimensionData[]>(),
  entryCache: emptyProjectCache<AgentMemoryEntriesSnapshot>(),
  activateScope: (projectId, agentId, dimension) => {
    if (!agentId) {
      set({
        activeDimensionScope: null,
        activeEntryScope: null,
        dimensions: [],
        entries: [],
        currentEntry: null,
        loading: false,
      })
      return
    }
    const nextDimensionScope = dimensionScope(projectId, agentId)
    const nextEntryScope = dimension ? entryScope(projectId, agentId, dimension) : null
    set((state) => {
      const dimensionCache = pruneProjectCache(
        touchProjectCache(state.dimensionCache, nextDimensionScope),
        nextDimensionScope,
        25,
      )
      const entryCache = nextEntryScope
        ? pruneProjectCache(touchProjectCache(state.entryCache, nextEntryScope), nextEntryScope, 25)
        : state.entryCache
      const entrySnapshot = nextEntryScope ? readProjectCache(entryCache, nextEntryScope)?.data : null
      return {
        activeDimensionScope: nextDimensionScope,
        activeEntryScope: nextEntryScope,
        dimensionCache,
        entryCache,
        dimensions: readProjectCache(dimensionCache, nextDimensionScope)?.data ?? [],
        entries: entrySnapshot?.entries ?? [],
        pinnedLimit: entrySnapshot?.pinnedLimit ?? 20,
        currentEntry: null,
        loading: false,
      }
    })
  },
  invalidateProject: (projectId) => set((state) => ({
    dimensionCache: mutateProjectScopes(
      state.dimensionCache,
      projectId,
      (cache, scope) => invalidateProjectCache(cache, scope),
    ),
    entryCache: mutateProjectScopes(
      state.entryCache,
      projectId,
      (cache, scope) => invalidateProjectCache(cache, scope),
    ),
  })),
  clearProjectCache: (projectId) => set((state) => ({
    dimensionCache: mutateProjectScopes(
      state.dimensionCache,
      projectId,
      (cache, scope) => clearProjectCache(cache, scope),
    ),
    entryCache: mutateProjectScopes(
      state.entryCache,
      projectId,
      (cache, scope) => clearProjectCache(cache, scope),
    ),
  })),
  clearError: () => set({ error: null }),

  fetchDimensions: async (projectId, agentId, options) => {
    const scope = dimensionScope(projectId, agentId)
    get().activateScope(projectId, agentId)
    const cached = readProjectCache(get().dimensionCache, scope)
    if (!options?.force && cached && !shouldRefreshProjectCache(cached)) return
    let requestSeq = 0
    set((state) => {
      const request = beginProjectRequest(state.dimensionCache, scope)
      requestSeq = request.requestSeq
      return {
        dimensionCache: request.state,
        loading: state.activeDimensionScope === scope && !cached,
        error: state.activeDimensionScope === scope ? null : state.error,
      }
    })
    try {
      const data = await wsClient.request({ type: 'agentMemory.dimensions.list', projectId, agentId }) as { dimensions: AgentMemoryDimensionData[] }
      set((state) => {
        const dimensionCache = pruneProjectCache(commitProjectResponse(state.dimensionCache, {
          scope,
          requestSeq,
          data: data.dimensions,
        }), state.activeDimensionScope ?? scope, 25)
        return {
          dimensionCache,
          dimensions: state.activeDimensionScope === scope ? data.dimensions : state.dimensions,
          loading: state.activeDimensionScope === scope ? false : state.loading,
        }
      })
    } catch (err) {
      if (get().activeDimensionScope === scope) set({ loading: false, error: errorMessage(err) })
    }
  },

  createDimension: async (projectId, agentId, input) => {
    set({ saving: true, error: null })
    try {
      const data = await wsClient.request({ type: 'agentMemory.dimensions.create', projectId, agentId, ...input }) as { dimension: AgentMemoryDimensionData }
      set({ saving: false })
      get().invalidateProject(projectId)
      await get().fetchDimensions(projectId, agentId, { force: true })
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
      get().invalidateProject(projectId)
      await get().fetchDimensions(projectId, agentId, { force: true })
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
      get().invalidateProject(projectId)
      await get().fetchDimensions(projectId, agentId, { force: true })
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  fetchEntries: async (projectId, agentId, dimension, options) => {
    const scope = entryScope(projectId, agentId, dimension)
    get().activateScope(projectId, agentId, dimension)
    const cached = readProjectCache(get().entryCache, scope)
    if (!options?.force && cached && !shouldRefreshProjectCache(cached)) return
    let requestSeq = 0
    set((state) => {
      const request = beginProjectRequest(state.entryCache, scope)
      requestSeq = request.requestSeq
      return {
        entryCache: request.state,
        loading: state.activeEntryScope === scope && !cached,
        error: state.activeEntryScope === scope ? null : state.error,
        fetchEntriesSeq: state.fetchEntriesSeq + 1,
      }
    })
    try {
      const data = await wsClient.request({ type: 'agentMemory.entries.list', projectId, agentId, dimension }) as { entries: AgentMemoryEntrySummary[]; pinnedLimit: number }
      const snapshot = { entries: data.entries, pinnedLimit: data.pinnedLimit ?? 20 }
      set((state) => {
        const entryCache = pruneProjectCache(commitProjectResponse(state.entryCache, {
          scope,
          requestSeq,
          data: snapshot,
        }), state.activeEntryScope ?? scope, 25)
        return {
          entryCache,
          entries: state.activeEntryScope === scope ? snapshot.entries : state.entries,
          pinnedLimit: state.activeEntryScope === scope ? snapshot.pinnedLimit : state.pinnedLimit,
          loading: state.activeEntryScope === scope ? false : state.loading,
        }
      })
    } catch (err) {
      if (get().activeEntryScope === scope) set({ loading: false, error: errorMessage(err) })
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
      get().invalidateProject(projectId)
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
      get().invalidateProject(projectId)
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
      get().invalidateProject(projectId)
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
