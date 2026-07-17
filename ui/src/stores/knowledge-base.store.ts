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

export interface KnowledgeProjectSnapshot {
  knowledgeBases: KnowledgeBaseData[]
  pagesByKbId: Record<string, KnowledgePageData[]>
  currentKbId: string | null
  currentPageId: string | null
  currentRead: KnowledgePageReadData | null
  activities: KnowledgeActivityData[]
  searchResults: KnowledgePageData[]
  isDirty: boolean
  remoteUpdatePending: boolean
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
  isDirty: boolean
  remoteUpdatePending: boolean
  activeProjectId: string | null
  projectCache: ProjectCacheState<KnowledgeProjectSnapshot>
  activateProject: (projectId: string) => void
  invalidateProject: (projectId: string) => void
  clearProjectCache: (projectId: string) => void
  setDirty: (dirty: boolean) => void
  clearError: () => void
  fetchKnowledgeBases: (projectId: string, options?: { force?: boolean }) => Promise<void>
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

const knowledgeFetches = new Map<string, Promise<void>>()
const knowledgeReadSeq = new Map<string, number>()

const EMPTY_KNOWLEDGE_SNAPSHOT: KnowledgeProjectSnapshot = {
  knowledgeBases: [],
  pagesByKbId: {},
  currentKbId: null,
  currentPageId: null,
  currentRead: null,
  activities: [],
  searchResults: [],
  isDirty: false,
  remoteUpdatePending: false,
}

function updateKnowledgeSnapshot(
  cache: ProjectCacheState<KnowledgeProjectSnapshot>,
  projectId: string,
  patch: Partial<KnowledgeProjectSnapshot>,
): ProjectCacheState<KnowledgeProjectSnapshot> {
  const entry = cache.entries[projectId]
  const now = Date.now()
  return {
    ...cache,
    entries: {
      ...cache.entries,
      [projectId]: {
        data: { ...(entry?.data ?? EMPTY_KNOWLEDGE_SNAPSHOT), ...patch },
        fetchedAt: entry?.fetchedAt ?? now,
        lastAccessedAt: now,
        invalidated: false,
        error: null,
      },
    },
  }
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
  isDirty: false,
  remoteUpdatePending: false,
  activeProjectId: null,
  projectCache: emptyProjectCache<KnowledgeProjectSnapshot>(),
  activateProject: (projectId) => set((state) => {
    const projectCache = pruneProjectCache(touchProjectCache(state.projectCache, projectId), projectId)
    const snapshot = readProjectCache(projectCache, projectId)?.data ?? EMPTY_KNOWLEDGE_SNAPSHOT
    return {
      activeProjectId: projectId,
      projectCache,
      ...snapshot,
      loading: false,
      pageLoading: false,
      error: null,
    }
  }),
  invalidateProject: (projectId) => set((state) => ({
    projectCache: invalidateProjectCache(state.projectCache, projectId),
  })),
  clearProjectCache: (projectId) => set((state) => ({
    projectCache: clearProjectCache(state.projectCache, projectId),
  })),
  setDirty: (dirty) => set((state) => ({
    isDirty: dirty,
    projectCache: state.activeProjectId
      ? updateKnowledgeSnapshot(state.projectCache, state.activeProjectId, { isDirty: dirty })
      : state.projectCache,
  })),
  clearError: () => set({ error: null }),

  fetchKnowledgeBases: async (projectId, options) => {
    const cached = readProjectCache(get().projectCache, projectId)
    if (!options?.force && cached && !shouldRefreshProjectCache(cached)) return
    const inFlight = knowledgeFetches.get(projectId)
    if (!options?.force && inFlight) return inFlight
    let requestSeq = 0
    set((state) => {
      const request = beginProjectRequest(state.projectCache, projectId)
      requestSeq = request.requestSeq
      return {
        projectCache: request.state,
        loading: state.activeProjectId === projectId && !cached,
        error: state.activeProjectId === projectId ? null : state.error,
      }
    })
    const request = (async (): Promise<void> => {
      try {
      const data = await wsClient.request({ type: 'knowledgeBases.list', projectId }) as { knowledgeBases: KnowledgeBaseData[] }
        const currentKbId = readProjectCache(get().projectCache, projectId)?.data.currentKbId
      const nextKbId = currentKbId && data.knowledgeBases.some((kb) => kb.id === currentKbId)
        ? currentKbId
        : data.knowledgeBases[0]?.id ?? null
        set((state) => {
          const current = readProjectCache(state.projectCache, projectId)?.data ?? EMPTY_KNOWLEDGE_SNAPSHOT
          const projectCache = pruneProjectCache(commitProjectResponse(state.projectCache, {
            scope: projectId,
            requestSeq,
            data: { ...current, knowledgeBases: data.knowledgeBases, currentKbId: nextKbId },
          }), state.activeProjectId ?? projectId)
          return {
            projectCache,
            knowledgeBases: state.activeProjectId === projectId ? data.knowledgeBases : state.knowledgeBases,
            currentKbId: state.activeProjectId === projectId ? nextKbId : state.currentKbId,
            loading: state.activeProjectId === projectId ? false : state.loading,
          }
        })
      if (nextKbId) await get().fetchPages(projectId, nextKbId)
      await get().fetchActivities(projectId, nextKbId ?? undefined)
    } catch (err) {
        if (get().activeProjectId === projectId) set({ loading: false, error: errorMessage(err) })
      }
    })()
    knowledgeFetches.set(projectId, request)
    try {
      await request
    } finally {
      if (knowledgeFetches.get(projectId) === request) knowledgeFetches.delete(projectId)
    }
  },

  fetchSharedKnowledgeBases: async () => {
    const data = await wsClient.request({ type: 'knowledgeBases.shared' }) as { knowledgeBases: KnowledgeBaseData[] }
    set({ sharedKnowledgeBases: data.knowledgeBases })
  },

  selectKnowledgeBase: async (projectId, kbId) => {
    set((state) => ({
      projectCache: updateKnowledgeSnapshot(state.projectCache, projectId, {
        currentKbId: kbId,
        currentPageId: null,
        currentRead: null,
      }),
      ...(state.activeProjectId === projectId
        ? { currentKbId: kbId, currentPageId: null, currentRead: null }
        : {}),
    }))
    await get().fetchPages(projectId, kbId)
    await get().fetchActivities(projectId, kbId)
  },

  fetchPages: async (projectId, kbId) => {
    const data = await wsClient.request({ type: 'knowledgePages.list', projectId, kbId }) as { pages: KnowledgePageData[] }
    const snapshot = readProjectCache(get().projectCache, projectId)?.data ?? EMPTY_KNOWLEDGE_SNAPSHOT
    const pagesByKbId = { ...snapshot.pagesByKbId, [kbId]: data.pages }
    const currentPageId = snapshot.currentPageId && data.pages.some((page) => page.id === snapshot.currentPageId)
      ? snapshot.currentPageId
      : data.pages[0]?.id ?? null
    set((state) => ({
      projectCache: updateKnowledgeSnapshot(state.projectCache, projectId, { pagesByKbId, currentPageId }),
      ...(state.activeProjectId === projectId ? { pagesByKbId, currentPageId } : {}),
    }))
    const state = get()
    // 编辑中(isDirty=true)不覆盖 currentRead,仅标记有新版本,避免用户草稿被覆盖
    if (state.isDirty && state.currentRead) {
      const remotePage = data.pages.find((p) => p.id === state.currentRead!.page.id)
      const localUpdatedAt = state.currentRead.page.updated_at
      if (remotePage && remotePage.updated_at !== localUpdatedAt) {
        set({ remoteUpdatePending: true })
      }
      return
    }
    if (currentPageId) await get().readPage(projectId, { pageId: currentPageId })
  },

  readPage: async (projectId, input) => {
    const seq = (knowledgeReadSeq.get(projectId) ?? 0) + 1
    knowledgeReadSeq.set(projectId, seq)
    if (get().activeProjectId === projectId) set({ pageLoading: true, error: null })
    try {
      const data = await wsClient.request({ type: 'knowledgePages.read', projectId, ...input }) as KnowledgePageReadData
      if (knowledgeReadSeq.get(projectId) !== seq) return data
      set((state) => ({
        projectCache: updateKnowledgeSnapshot(state.projectCache, projectId, {
          currentRead: data,
          currentPageId: data.page.id,
          currentKbId: data.kb.id,
          remoteUpdatePending: false,
        }),
        ...(state.activeProjectId === projectId
          ? {
              currentRead: data,
              currentPageId: data.page.id,
              currentKbId: data.kb.id,
              pageLoading: false,
              remoteUpdatePending: false,
            }
          : {}),
      }))
      return data
    } catch (err) {
      if (get().activeProjectId === projectId) set({ pageLoading: false, error: errorMessage(err) })
      throw err
    }
  },

  searchPages: async (projectId, query, kbIds) => {
    if (!query.trim()) {
      set((state) => ({
        projectCache: updateKnowledgeSnapshot(state.projectCache, projectId, { searchResults: [] }),
        searchResults: state.activeProjectId === projectId ? [] : state.searchResults,
      }))
      return
    }
    const data = await wsClient.request({ type: 'knowledgePages.search', projectId, query, kbIds }) as { pages: KnowledgePageData[] }
    set((state) => ({
      projectCache: updateKnowledgeSnapshot(state.projectCache, projectId, { searchResults: data.pages }),
      searchResults: state.activeProjectId === projectId ? data.pages : state.searchResults,
    }))
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
      set((state) => ({
        saving: false,
        isDirty: false,
        remoteUpdatePending: false,
        projectCache: updateKnowledgeSnapshot(state.projectCache, projectId, {
          isDirty: false,
          remoteUpdatePending: false,
        }),
      }))
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
    set((state) => ({
      projectCache: updateKnowledgeSnapshot(state.projectCache, projectId, { activities: data.activities }),
      activities: state.activeProjectId === projectId ? data.activities : state.activities,
    }))
  },

  revertActivity: async (projectId, activityId) => {
    const data = await wsClient.request({ type: 'knowledgeActivities.revert', projectId, activityId }) as { page?: KnowledgePageData; activity: KnowledgeActivityData }
    const kbId = data.page?.kb_id ?? data.activity.kb_id
    await get().fetchPages(projectId, kbId)
    await get().fetchActivities(projectId, kbId)
    if (data.page) await get().readPage(projectId, { pageId: data.page.id })
  },

  setupListeners: () => {
    const off = wsClient.on('knowledge-base:update', (msg) => {
      const projectId = typeof msg.projectId === 'string' ? msg.projectId : get().activeProjectId
      void get().fetchSharedKnowledgeBases()
      if (projectId) {
        get().invalidateProject(projectId)
        if (projectId === get().activeProjectId) void get().fetchKnowledgeBases(projectId, { force: true })
      }
    })
    return off
  },
}))

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
