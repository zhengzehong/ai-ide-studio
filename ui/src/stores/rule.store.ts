import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface RuleData {
  id: string
  name: string
  description: string | null
  cron: string
  action: string
  action_config: Record<string, unknown>
  enabled: boolean
  last_run_at: string | null
  last_fail_at: string | null
  next_run_at: string | null
  run_count: number
  fail_count: number
  max_runs: number | null
  created_by: string | null
  trigger_type: string
  created_at: string
  updated_at: string
  project_id: string | null
}

export interface RuleExecution {
  id: string
  rule_id: string
  status: 'success' | 'failed' | 'skipped'
  task_id: string | null
  session_id: string | null
  error: string | null
  triggered_at: string
  completed_at: string | null
}

interface RuleStore {
  rules: RuleData[]
  loading: boolean
  fetchRules: (projectId?: string) => Promise<void>
  createRule: (input: {
    name: string
    cron: string
    action: string
    actionConfig: Record<string, unknown>
    description?: string
    projectId?: string
    maxRuns?: number
  }) => Promise<RuleData>
  updateRule: (ruleId: string, fields: Record<string, unknown>) => Promise<RuleData | null>
  toggleRule: (ruleId: string, enabled: boolean) => Promise<void>
  deleteRule: (ruleId: string) => Promise<void>
  runNow: (ruleId: string) => Promise<void>
  fetchExecutions: (ruleId: string, limit?: number) => Promise<RuleExecution[]>
  setupListeners: () => () => void
}

export const useRuleStore = create<RuleStore>((set, get) => ({
  rules: [],
  loading: false,

  fetchRules: async (projectId?: string) => {
    set({ loading: true })
    try {
      const msg: Record<string, unknown> = { type: 'rules.list' }
      if (projectId) msg.projectId = projectId
      const data = await wsClient.request(msg) as RuleData[]
      set({ rules: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createRule: async (input) => {
    const msg: Record<string, unknown> = {
      type: 'rules.create',
      name: input.name,
      cron: input.cron,
      action: input.action,
      actionConfig: input.actionConfig,
    }
    if (input.description) msg.description = input.description
    if (input.projectId) msg.projectId = input.projectId
    if (input.maxRuns) msg.maxRuns = input.maxRuns
    const rule = await wsClient.request(msg) as RuleData
    set({ rules: [rule, ...get().rules] })
    return rule
  },

  updateRule: async (ruleId, fields) => {
    const msg: Record<string, unknown> = { type: 'rules.update', ruleId, ...fields }
    const result = await wsClient.request(msg) as RuleData | null
    if (result) {
      set({ rules: get().rules.map(r => r.id === ruleId ? { ...r, ...result } : r) })
    }
    return result
  },

  toggleRule: async (ruleId, enabled) => {
    await wsClient.request({ type: 'rules.toggle', ruleId, enabled })
  },

  deleteRule: async (ruleId) => {
    await wsClient.request({ type: 'rules.delete', ruleId })
  },

  runNow: async (ruleId) => {
    await wsClient.request({ type: 'rules.runNow', ruleId })
  },

  fetchExecutions: async (ruleId, limit = 20) => {
    return await wsClient.request({ type: 'rules.executions', ruleId, limit }) as RuleExecution[]
  },

  setupListeners: () => {
    const off = wsClient.on('rule:update', (msg) => {
      const ruleId = msg.ruleId as string
      const data = msg.data as Record<string, unknown>
      if (data.event === 'deleted') {
        set({ rules: get().rules.filter(r => r.id !== ruleId) })
      } else {
        const existing = get().rules.find(r => r.id === ruleId)
        if (existing) {
          set({ rules: get().rules.map(r => r.id === ruleId ? { ...r, ...data } as RuleData : r) })
        } else if (data.id) {
          set({ rules: [data as unknown as RuleData, ...get().rules] })
        }
      }
    })
    return off
  },
}))
