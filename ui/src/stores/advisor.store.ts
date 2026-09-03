import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface AdvisorConfig {
  projectId: string
  sessionId: string | null
  advisorAgentId: string | null
  advisorPrompt: string
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
  error: string | null
  load: (projectId: string, silent?: boolean) => Promise<void>
  markRead: (ids: string[] | null) => Promise<void>
  accept: (suggestionId: string, input: { agentId: string; sessionId?: string; execute: boolean; title?: string; descriptionMarkdown?: string }) => Promise<AdvisorSuggestionView>
  ignore: (suggestionId: string) => Promise<void>
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
  error: null,

  load: async (projectId, silent = false) => {
    const sequence = ++loadSequence
    if (!silent) set({ projectId, loading: true, error: null })
    try {
      const data = await wsClient.request({ type: 'advisor.get', projectId }) as AdvisorWorkspace
      if (sequence !== loadSequence) return
      set({ projectId, config: data.config, view: data.suggestions, loading: false, error: null })
    } catch (error) {
      if (sequence !== loadSequence) return
      set({ loading: false, error: message(error, '参谋建议加载失败') })
    }
  },

  markRead: async (ids) => {
    const projectId = requireProject(get().projectId)
    await wsClient.request({ type: 'advisor.suggestion.markRead', projectId, ids })
    await get().load(projectId, true)
  },

  accept: async (suggestionId, input) => {
    const projectId = requireProject(get().projectId)
    const view = await wsClient.request({
      type: 'advisor.suggestion.accept', projectId, suggestionId,
      agentId: input.agentId, execute: input.execute,
      title: input.title, descriptionMarkdown: input.descriptionMarkdown,
      ...(input.sessionId ? { sessionId: input.sessionId, sessionMode: 'existing' } : {}),
    }) as AdvisorSuggestionView
    set({ view })
    return view
  },

  ignore: async (suggestionId) => {
    const projectId = requireProject(get().projectId)
    const data = await wsClient.request({
      type: 'advisor.suggestion.ignore', projectId, suggestionId,
    }) as { suggestions: AdvisorSuggestionView }
    set({ view: data.suggestions })
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
    const refresh = (): void => {
      const projectId = get().projectId
      if (projectId) void get().load(projectId, true)
    }
    const offUpdate = wsClient.on('advisor:update', (event) => {
      if (event.projectId === get().projectId) refresh()
    })
    const offReconnect = wsClient.on('reconnected', refresh)
    return () => { offUpdate(); offReconnect() }
  },
}))

function requireProject(projectId: string | null): string {
  if (!projectId) throw new Error('未选择项目')
  return projectId
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
