import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import { useProjectStore } from './project.store'

export type KnowledgeBaseKind = 'project' | 'shared'
export type KnowledgeBaseSource = 'manual' | 'code'

export interface KnowledgeBaseData {
  id: string
  name: string
  kind: KnowledgeBaseKind
  src: KnowledgeBaseSource
  icon: string | null
  description: string | null
  project_id: string | null
  index_page_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface KnowledgePageData {
  id: string
  kb_id: string
  title: string
  title_norm: string
  section: string | null
  summary: string | null
  body: string
  author: string
  by: string | null
  tags_json: string
  is_index: number
  src_files_json: string
  src_fingerprint_json: string | null
  stale: number
  last_human_edit_at: string | null
  last_activity_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface KnowledgeLinkData {
  text: string
  kbId: string | null
  pageId: string | null
  title: string
  status: 'resolved' | 'missing' | 'ambiguous' | 'invisible'
}

export interface KnowledgeBacklinkData {
  kbId: string
  pageId: string
  title: string
}

export interface KnowledgeActivityData {
  id: string
  kb_id: string
  page_id: string | null
  act: string
  actor: string
  actor_type: string
  tool: string
  note: string | null
  prev_body: string | null
  prev_snapshot_json: string | null
  next_snapshot_json: string | null
  reverted_at: string | null
  reverted_by: string | null
  revert_activity_id: string | null
  created_at: string
}

export interface KnowledgePageReadData {
  kb: KnowledgeBaseData
  page: KnowledgePageData
  outLinks: KnowledgeLinkData[]
  backlinks: KnowledgeBacklinkData[]
}

interface KnowledgeBaseStore {
  knowledgeBases: KnowledgeBaseData[]
  sharedKnowledgeBases: KnowledgeBaseData[]
  pagesByKbId: Record<string, KnowledgePageData[]>
  currentKbId: string | null
  currentPageId: string | null
  currentRead: KnowledgePageReadData | null
  activities: KnowledgeActivityData[]
  searchResults: KnowledgePageData[]
  loading: boolean
  pageLoading: boolean
  saving: boolean
  error: string | null
  clearError: () => void
  fetchKnowledgeBases: (projectId: string) => Promise<void>
  fetchSharedKnowledgeBases: () => Promise<void>
  selectKnowledgeBase: (projectId: string, kbId: string) => Promise<void>
  fetchPages: (projectId: string, kbId: string) => Promise<void>
  readPage: (projectId: string, input: { pageId?: string; kbId?: string; title?: string }) => Promise<KnowledgePageReadData>
  searchPages: (projectId: string, query: string, kbIds?: string[]) => Promise<void>
  createKnowledgeBase: (projectId: string, input: { name: string; kind: KnowledgeBaseKind; src: KnowledgeBaseSource; description?: string; icon?: string }) => Promise<KnowledgeBaseData>
  mountKnowledgeBase: (projectId: string, kbId: string) => Promise<void>
  unmountKnowledgeBase: (projectId: string, kbId: string) => Promise<void>
  createPage: (projectId: string, input: { kbId: string; title: string; section?: string; summary?: string; body: string; tags?: string[]; srcFiles?: string[] }) => Promise<KnowledgePageData>
  updatePage: (projectId: string, input: { pageId: string; title?: string; section?: string | null; summary?: string | null; body: string; tags?: string[] }) => Promise<KnowledgePageData>
  refreshFromCode: (projectId: string, input: { pageId: string; body: string; srcFiles?: string[]; confirmOverwriteHumanEdit?: boolean }) => Promise<KnowledgePageData>
  fetchActivities: (projectId: string, kbId?: string) => Promise<void>
  revertActivity: (projectId: string, activityId: string) => Promise<void>
  setupListeners: () => () => void
}

export const useKnowledgeBaseStore = create<KnowledgeBaseStore>((set, get) => ({
  knowledgeBases: [],
  sharedKnowledgeBases: [],
  pagesByKbId: {},
  currentKbId: null,
  currentPageId: null,
  currentRead: null,
  activities: [],
  searchResults: [],
  loading: false,
  pageLoading: false,
  saving: false,
  error: null,
  clearError: () => set({ error: null }),

  fetchKnowledgeBases: async (projectId) => {
    set({ loading: true, error: null })
    try {
      const data = await wsClient.request({ type: 'knowledgeBases.list', projectId }) as { knowledgeBases: KnowledgeBaseData[] }
      const currentKbId = get().currentKbId
      const nextKbId = currentKbId && data.knowledgeBases.some((kb) => kb.id === currentKbId)
        ? currentKbId
        : data.knowledgeBases[0]?.id ?? null
      set({ knowledgeBases: data.knowledgeBases, currentKbId: nextKbId, loading: false })
      if (nextKbId) await get().fetchPages(projectId, nextKbId)
      await get().fetchActivities(projectId, nextKbId ?? undefined)
    } catch (err) {
      set({ loading: false, error: errorMessage(err) })
    }
  },

  fetchSharedKnowledgeBases: async () => {
    const data = await wsClient.request({ type: 'knowledgeBases.shared' }) as { knowledgeBases: KnowledgeBaseData[] }
    set({ sharedKnowledgeBases: data.knowledgeBases })
  },

  selectKnowledgeBase: async (projectId, kbId) => {
    set({ currentKbId: kbId, currentPageId: null, currentRead: null })
    await get().fetchPages(projectId, kbId)
    await get().fetchActivities(projectId, kbId)
  },

  fetchPages: async (projectId, kbId) => {
    const data = await wsClient.request({ type: 'knowledgePages.list', projectId, kbId }) as { pages: KnowledgePageData[] }
    set((state) => ({ pagesByKbId: { ...state.pagesByKbId, [kbId]: data.pages } }))
    const state = get()
    const currentPageId = state.currentPageId && data.pages.some((page) => page.id === state.currentPageId)
      ? state.currentPageId
      : data.pages[0]?.id ?? null
    if (currentPageId) await get().readPage(projectId, { pageId: currentPageId })
  },

  readPage: async (projectId, input) => {
    set({ pageLoading: true, error: null })
    try {
      const data = await wsClient.request({ type: 'knowledgePages.read', projectId, ...input }) as KnowledgePageReadData
      set({ currentRead: data, currentPageId: data.page.id, currentKbId: data.kb.id, pageLoading: false })
      return data
    } catch (err) {
      set({ pageLoading: false, error: errorMessage(err) })
      throw err
    }
  },

  searchPages: async (projectId, query, kbIds) => {
    if (!query.trim()) {
      set({ searchResults: [] })
      return
    }
    const data = await wsClient.request({ type: 'knowledgePages.search', projectId, query, kbIds }) as { pages: KnowledgePageData[] }
    set({ searchResults: data.pages })
  },

  createKnowledgeBase: async (projectId, input) => {
    set({ saving: true, error: null })
    try {
      const data = await wsClient.request({ type: 'knowledgeBases.create', projectId, ...input }) as { kb: KnowledgeBaseData }
      if (data.kb.kind === 'shared') {
        await wsClient.request({ type: 'knowledgeBases.mount', projectId, kbId: data.kb.id })
        await get().fetchSharedKnowledgeBases()
      }
      await get().fetchKnowledgeBases(projectId)
      await get().selectKnowledgeBase(projectId, data.kb.id)
      set({ saving: false })
      return data.kb
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  mountKnowledgeBase: async (projectId, kbId) => {
    await wsClient.request({ type: 'knowledgeBases.mount', projectId, kbId })
    await get().fetchKnowledgeBases(projectId)
  },

  unmountKnowledgeBase: async (projectId, kbId) => {
    await wsClient.request({ type: 'knowledgeBases.unmount', projectId, kbId })
    await get().fetchKnowledgeBases(projectId)
  },

  createPage: async (projectId, input) => {
    set({ saving: true, error: null })
    try {
      const data = await wsClient.request({ type: 'knowledgePages.create', projectId, ...input }) as { page: KnowledgePageData }
      await get().fetchPages(projectId, input.kbId)
      await get().fetchActivities(projectId, input.kbId)
      await get().readPage(projectId, { pageId: data.page.id })
      set({ saving: false })
      return data.page
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  updatePage: async (projectId, input) => {
    set({ saving: true, error: null })
    try {
      const data = await wsClient.request({ type: 'knowledgePages.update', projectId, ...input }) as { page: KnowledgePageData }
      await get().fetchPages(projectId, data.page.kb_id)
      await get().fetchActivities(projectId, data.page.kb_id)
      await get().readPage(projectId, { pageId: data.page.id })
      set({ saving: false })
      return data.page
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  refreshFromCode: async (projectId, input) => {
    set({ saving: true, error: null })
    try {
      const data = await wsClient.request({ type: 'knowledgePages.refreshFromCode', projectId, ...input }) as { page: KnowledgePageData }
      await get().fetchPages(projectId, data.page.kb_id)
      await get().fetchActivities(projectId, data.page.kb_id)
      await get().readPage(projectId, { pageId: data.page.id })
      set({ saving: false })
      return data.page
    } catch (err) {
      set({ saving: false, error: errorMessage(err) })
      throw err
    }
  },

  fetchActivities: async (projectId, kbId) => {
    const data = await wsClient.request({ type: 'knowledgeActivities.list', projectId, kbId }) as { activities: KnowledgeActivityData[] }
    set({ activities: data.activities })
  },

  revertActivity: async (projectId, activityId) => {
    const data = await wsClient.request({ type: 'knowledgeActivities.revert', projectId, activityId }) as { page?: KnowledgePageData; activity: KnowledgeActivityData }
    const kbId = data.page?.kb_id ?? data.activity.kb_id
    await get().fetchPages(projectId, kbId)
    await get().fetchActivities(projectId, kbId)
    if (data.page) await get().readPage(projectId, { pageId: data.page.id })
  },

  setupListeners: () => {
    const off = wsClient.on('knowledge-base:update', () => {
      const projectId = useProjectStore.getState().currentProjectId
      void get().fetchSharedKnowledgeBases()
      if (projectId) void get().fetchKnowledgeBases(projectId)
    })
    return off
  },
}))

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
