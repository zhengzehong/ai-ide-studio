import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import type { SessionData } from './session.store'

export type AutonomyPlanStatus = 'current' | 'next' | 'done'
export type AutonomyReportPriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface AutonomyInterestData {
  id: string
  text: string
  createdAt: string
}

export interface AutonomyPlanItemData {
  id: string
  title: string
  status: AutonomyPlanStatus
  note?: string
}

export interface AgentAutonomyStateData {
  agentId: string
  projectId: string
  runtime: string
  config: {
    enabled: boolean
    prompt: string
    interests: AutonomyInterestData[]
    plan: {
      date: string
      items: AutonomyPlanItemData[]
      nextCheckAt: string | null
      updatedAt: string | null
    }
    autonomySessionId: string | null
    lastRunAt: string | null
    lastSkipReason: string | null
    lastError: string | null
  }
  session: SessionData | null
  memory: {
    path: string
    content: string
    updatedAt: string | null
    truncated: boolean
  }
}

export interface AutonomyReportData {
  id: string
  project_id: string
  agent_id: string
  session_id: string
  title: string
  summary: string
  priority: AutonomyReportPriority
  body_markdown: string
  attachments: Array<{ path: string; title?: string }>
  created_at: string
}

interface AutonomyStore {
  projectId: string | null
  states: AgentAutonomyStateData[]
  selectedAgentId: string | null
  selected: AgentAutonomyStateData | null
  reports: AutonomyReportData[]
  loading: boolean
  saving: boolean
  error: string | null
  load: (projectId: string, preferredAgentId?: string | null) => Promise<void>
  selectAgent: (agentId: string) => Promise<void>
  enable: () => Promise<void>
  disable: () => Promise<void>
  runNow: () => Promise<void>
  updatePrompt: (prompt: string) => Promise<void>
  addInterest: (text: string) => Promise<void>
  removeInterest: (interestId: string) => Promise<void>
  setupListeners: () => () => void
  clearError: () => void
}

let loadGeneration = 0

export const useAutonomyStore = create<AutonomyStore>((set, get) => ({
  projectId: null,
  states: [],
  selectedAgentId: null,
  selected: null,
  reports: [],
  loading: false,
  saving: false,
  error: null,

  load: async (projectId, preferredAgentId) => {
    const generation = ++loadGeneration
    set({ projectId, loading: true, error: null })
    try {
      const states = await request<AgentAutonomyStateData[]>({ type: 'autonomy.list', projectId })
      if (generation !== loadGeneration || get().projectId !== projectId) return
      const candidate = preferredAgentId ?? get().selectedAgentId
      const selectedAgentId = states.some((item) => item.agentId === candidate)
        ? candidate
        : states[0]?.agentId ?? null
      set({ states, selectedAgentId })
      if (!selectedAgentId) {
        set({ selected: null, reports: [], loading: false })
        return
      }
      const [selected, reports] = await Promise.all([
        request<AgentAutonomyStateData>({ type: 'autonomy.get', projectId, agentId: selectedAgentId }),
        request<AutonomyReportData[]>({ type: 'autonomy.reports.list', projectId, agentId: selectedAgentId, limit: 50 }),
      ])
      if (generation !== loadGeneration || get().projectId !== projectId) return
      set({ selected, reports, loading: false })
    } catch (error) {
      if (generation !== loadGeneration) return
      set({ error: message(error, '自主 Agent 加载失败'), loading: false })
    }
  },

  selectAgent: async (agentId) => {
    const projectId = get().projectId
    if (!projectId || agentId === get().selectedAgentId) return
    const generation = ++loadGeneration
    set({ selectedAgentId: agentId, selected: null, reports: [], loading: true, error: null })
    try {
      const [selected, reports] = await Promise.all([
        request<AgentAutonomyStateData>({ type: 'autonomy.get', projectId, agentId }),
        request<AutonomyReportData[]>({ type: 'autonomy.reports.list', projectId, agentId, limit: 50 }),
      ])
      if (generation !== loadGeneration || get().selectedAgentId !== agentId) return
      set({ selected, reports, loading: false })
    } catch (error) {
      if (generation !== loadGeneration) return
      set({ error: message(error, 'Agent 自主状态加载失败'), loading: false })
    }
  },

  enable: () => mutateSelected('autonomy.enable', get, set),
  disable: () => mutateSelected('autonomy.disable', get, set),

  runNow: async () => {
    const current = requireSelected(get())
    set({ saving: true, error: null })
    try {
      await request({ type: 'autonomy.runNow', projectId: current.projectId, agentId: current.agentId })
    } catch (error) {
      set({ error: message(error, '启动自主检查失败') })
    } finally {
      set({ saving: false })
    }
  },

  updatePrompt: async (prompt) => {
    const current = requireSelected(get())
    set({ saving: true, error: null })
    try {
      const selected = await request<AgentAutonomyStateData>({
        type: 'autonomy.update', projectId: current.projectId, agentId: current.agentId, prompt,
      })
      updateSelectedState(selected, get, set)
    } catch (error) {
      set({ error: message(error, '自主提示词保存失败') })
    } finally {
      set({ saving: false })
    }
  },

  addInterest: async (text) => mutateInterest('autonomy.interest.add', { text }, get, set),
  removeInterest: async (interestId) => mutateInterest('autonomy.interest.remove', { interestId }, get, set),

  setupListeners: () => wsClient.on('autonomy:update', (messageData) => {
    const projectId = get().projectId
    if (!projectId || messageData.projectId !== projectId) return
    void get().load(projectId, get().selectedAgentId)
  }),

  clearError: () => set({ error: null }),
}))

async function mutateSelected(
  type: 'autonomy.enable' | 'autonomy.disable',
  get: () => AutonomyStore,
  set: (patch: Partial<AutonomyStore>) => void,
): Promise<void> {
  const current = requireSelected(get())
  set({ saving: true, error: null })
  try {
    const selected = await request<AgentAutonomyStateData>({ type, projectId: current.projectId, agentId: current.agentId })
    updateSelectedState(selected, get, set)
  } catch (error) {
    set({ error: message(error, type === 'autonomy.enable' ? '启用自主模式失败' : '停用自主模式失败') })
  } finally {
    set({ saving: false })
  }
}

async function mutateInterest(
  type: 'autonomy.interest.add' | 'autonomy.interest.remove',
  payload: { text?: string; interestId?: string },
  get: () => AutonomyStore,
  set: (patch: Partial<AutonomyStore>) => void,
): Promise<void> {
  const current = requireSelected(get())
  set({ saving: true, error: null })
  try {
    const selected = await request<AgentAutonomyStateData>({
      type, projectId: current.projectId, agentId: current.agentId, ...payload,
    })
    updateSelectedState(selected, get, set)
  } catch (error) {
    set({ error: message(error, '关注点更新失败') })
  } finally {
    set({ saving: false })
  }
}

function updateSelectedState(
  selected: AgentAutonomyStateData,
  get: () => AutonomyStore,
  set: (patch: Partial<AutonomyStore>) => void,
): void {
  set({
    selected,
    states: get().states.map((item) => item.agentId === selected.agentId ? selected : item),
  })
}

function requireSelected(state: AutonomyStore): AgentAutonomyStateData {
  if (!state.selected) throw new Error('请先选择 Agent')
  return state.selected
}

async function request<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  return await wsClient.request(payload) as T
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
