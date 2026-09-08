import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import { filterAdvisorView, receivedAdvisorView, suggestionDeadline } from './advisor-list-lifecycle'

export interface AdvisorConfig {
  projectId: string
  sessionId: string | null
  advisorAgentId: string | null
  advisorPrompt: string
  defaultAdvisorPrompt: string
  minSilenceMinutes: number
  enabled: boolean
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface AdvisorArtifact {
  name: string
  relativePath: string
  size: number
  previewId: string
}

export interface AdvisorSourceEvidence {
  sessionId: string
  title: string
}

export type AdvisorSuggestionStatus = 'pending' | 'viewed' | 'accepted' | 'created' | 'ignored'

export interface AdvisorSuggestion {
  id: string
  project_id: string
  round_id: string
  trigger_session_id: string | null
  sort_order: number
  type: 'plan' | 'action'
  title: string
  description_markdown: string
  artifact_json: string | null
  source_evidence_json: string
  suggested_agent_id: string | null
  agent_reason: string
  status: AdvisorSuggestionStatus
  dispatch_token: string | null
  task_id: string | null
  execution_session_id: string | null
  created_at: string
  updated_at: string
  expire_at: string
}

export interface AdvisorSuggestionView {
  serverNow?: string
  suggestions: AdvisorSuggestion[]
  expired: AdvisorSuggestion[]
  settled: AdvisorSuggestion[]
  pendingCount: number
}

export interface AdvisorWorkspace {
  config: AdvisorConfig
  suggestions: AdvisorSuggestionView
}

export function parseArtifact(suggestion: AdvisorSuggestion): AdvisorArtifact | null {
  if (!suggestion.artifact_json) return null
  try {
    const parsed = JSON.parse(suggestion.artifact_json) as Partial<AdvisorArtifact>
    if (!parsed.previewId || !parsed.name) return null
    return {
      name: parsed.name,
      relativePath: parsed.relativePath ?? '',
      size: parsed.size ?? 0,
      previewId: parsed.previewId,
    }
  } catch {
    return null
  }
}

export function parseEvidence(suggestion: AdvisorSuggestion): AdvisorSourceEvidence[] {
  try {
    const parsed = JSON.parse(suggestion.source_evidence_json) as Partial<AdvisorSourceEvidence>[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => typeof item?.sessionId === 'string') as AdvisorSourceEvidence[]
  } catch {
    return []
  }
}

export function formatArtifactSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** glm 系执行 Agent 标注（用户约定：glm 快、便宜、中文好） */
export function isGlmAgent(name: string): boolean {
  return name.toLowerCase().includes('glm')
}

interface AdvisorState {
  projectId: string | null
  config: AdvisorConfig | null
  view: AdvisorSuggestionView | null
  loading: boolean
  saving: boolean
  ignoring: boolean
  actionError: string | null
  clockOffsetMs: number
  error: string | null
  load: (projectId: string, silent?: boolean) => Promise<void>
  markRead: (ids: string[] | null) => Promise<void>
  accept: (suggestionId: string, input: { agentId: string; sessionId?: string; execute: boolean; title?: string; descriptionMarkdown?: string }) => Promise<AdvisorSuggestionView>
  ignore: (suggestionId: string) => Promise<void>
  ignoreAll: () => Promise<number>
  dismiss: (ids: string[], bulk: boolean) => Promise<number>
  configure: (input: { advisorAgentId: string; advisorPrompt?: string; enabled?: boolean }) => Promise<void>
  rebuildSession: (advisorAgentId: string) => Promise<void>
  setupListeners: () => () => void
}

let loadSequence = 0

export const useAdvisorStore = create<AdvisorState>((set, get) => ({
  projectId: null,
  config: null,
  view: null,
  loading: false,
  saving: false,
  ignoring: false,
  actionError: null,
  clockOffsetMs: 0,
  error: null,

  load: async (projectId, silent = false) => {
    if (silent && projectId !== get().projectId) return
    const sequence = ++loadSequence
    if (!silent) set({
      projectId, loading: true, error: null, actionError: null,
      ...(projectId !== get().projectId ? { view: null, config: null } : {}),
    })
    try {
      const data = await wsClient.request({ type: 'advisor.get', projectId }) as AdvisorWorkspace
      if (sequence !== loadSequence) return
      set({ projectId, config: data.config, ...receivedAdvisorView(data.suggestions), loading: false, error: null })
    } catch (error) {
      if (sequence !== loadSequence) return
      set({ loading: false, error: message(error, '参谋建议加载失败') })
    }
  },

  markRead: async (ids) => {
    const projectId = requireProject(get().projectId)
    await wsClient.request({ type: 'advisor.suggestion.markRead', projectId, ids })
    if (get().projectId === projectId) await get().load(projectId, true)
  },

  accept: async (suggestionId, input) => {
    const projectId = requireProject(get().projectId)
    const sequence = ++loadSequence
    const view = await wsClient.request({
      type: 'advisor.suggestion.accept', projectId, suggestionId,
      agentId: input.agentId, execute: input.execute,
      title: input.title, descriptionMarkdown: input.descriptionMarkdown,
      ...(input.sessionId ? { sessionId: input.sessionId, sessionMode: 'existing' } : {}),
    }) as AdvisorSuggestionView
    if (get().projectId === projectId) {
      if (sequence === loadSequence) set(receivedAdvisorView(view))
      await get().load(projectId, true)
    }
    return view
  },

  ignore: async (suggestionId) => {
    await get().dismiss([suggestionId], false)
  },

  ignoreAll: async () => {
    const state = get()
    const view = state.view && filterAdvisorView(state.view, Date.now() + state.clockOffsetMs)
    const ids = view?.suggestions.filter(row => !row.task_id && !row.dispatch_token).map(row => row.id) ?? []
    return get().dismiss(ids, true)
  },

  dismiss: async (ids, bulk) => {
    if (get().ignoring || ids.length === 0) return 0
    const projectId = requireProject(get().projectId)
    const sequence = ++loadSequence
    set({ ignoring: true, actionError: null })
    try {
      const data = await wsClient.request(bulk
        ? { type: 'advisor.suggestion.ignoreAll', projectId, ids }
        : { type: 'advisor.suggestion.ignore', projectId, suggestionId: ids[0] }
      ) as { suggestions: AdvisorSuggestionView; ignoredCount?: number }
      if (get().projectId === projectId) {
        if (sequence === loadSequence) set(receivedAdvisorView(data.suggestions))
        await get().load(projectId, true)
      }
      return data.ignoredCount ?? 1
    } catch (error) {
      if (get().projectId === projectId) set({ actionError: message(error, '忽略建议失败') })
      throw error
    } finally {
      set({ ignoring: false })
    }
  },

  configure: async (input) => {
    const projectId = requireProject(get().projectId)
    set({ saving: true, error: null })
    try {
      const config = await wsClient.request({ type: 'advisor.configure', projectId, ...input }) as AdvisorConfig
      set({ config, saving: false })
    } catch (error) {
      set({ saving: false, error: message(error, '参谋设置保存失败') })
      throw error
    }
  },

  rebuildSession: async (advisorAgentId) => {
    const projectId = requireProject(get().projectId)
    const config = await wsClient.request({
      type: 'advisor.session.rebuild', projectId, advisorAgentId,
    }) as AdvisorConfig
    set({ config })
  },

  setupListeners: () => {
    let expiryTimer: ReturnType<typeof setTimeout> | undefined
    const expireLocal = (): void => {
      const state = get()
      if (!state.view) return
      const view = filterAdvisorView(state.view, Date.now() + state.clockOffsetMs)
      if (view !== state.view) set({ view })
    }
    const scheduleExpiry = (): void => {
      clearTimeout(expiryTimer)
      const state = get()
      const rows = state.view ? [...state.view.suggestions, ...state.view.settled] : []
      const deadline = Math.min(...rows.map(suggestionDeadline))
      if (Number.isFinite(deadline)) {
        expiryTimer = setTimeout(expireLocal, Math.max(1, Math.min(2_147_483_647, deadline - Date.now() - state.clockOffsetMs)))
      }
    }
    const offState = useAdvisorStore.subscribe((state, previous) => {
      if (state.view !== previous.view || state.clockOffsetMs !== previous.clockOffsetMs) scheduleExpiry()
    })
    expireLocal()
    scheduleExpiry()
    const refresh = (): void => {
      expireLocal()
      const projectId = get().projectId
      if (projectId) void get().load(projectId, true)
    }
    const resume = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') refresh()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', resume)
    if (typeof window !== 'undefined') window.addEventListener('focus', refresh)
    const offUpdate = wsClient.on('advisor:update', (event) => {
      if (event.projectId === get().projectId) refresh()
    })
    const offReconnect = wsClient.on('reconnected', refresh)
    return () => {
      offUpdate(); offReconnect(); offState(); clearTimeout(expiryTimer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resume)
      if (typeof window !== 'undefined') window.removeEventListener('focus', refresh)
    }
  },
}))

function requireProject(projectId: string | null): string {
  if (!projectId) throw new Error('未选择项目')
  return projectId
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
