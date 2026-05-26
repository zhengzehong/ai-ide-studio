import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface RuleData {
  id: string
  name: string
  description: string | null
  cron: string
  action: string
  action_config: {
    title: string
    description?: string
    assign_agent_id?: string
  }
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  run_count: number
  created_at: string
  updated_at: string
}

interface RuleStore {
  rules: RuleData[]
  loading: boolean
  fetchRules: () => Promise<void>
  createRule: (input: {
    name: string
    cron: string
    action: string
    actionConfig: { title: string; description?: string; assignAgentId?: string }
    description?: string
  }) => Promise<RuleData>
  toggleRule: (ruleId: string, enabled: boolean) => Promise<void>
  deleteRule: (ruleId: string) => Promise<void>
  setupListeners: () => () => void
}

export const useRuleStore = create<RuleStore>((set, get) => ({
  rules: [],
  loading: false,

  fetchRules: async () => {
    set({ loading: true })
    try {
      const data = await wsClient.request({ type: 'rules.list' }) as RuleData[]
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
    const rule = await wsClient.request(msg) as RuleData
    set({ rules: [rule, ...get().rules] })
    return rule
  },

  toggleRule: async (ruleId, enabled) => {
    await wsClient.request({ type: 'rules.toggle', ruleId, enabled })
  },

  deleteRule: async (ruleId) => {
    await wsClient.request({ type: 'rules.delete', ruleId })
  },

  setupListeners: () => {
    const off = wsClient.on('rule:update', (msg) => {
      const ruleId = msg.ruleId as string
      const data = msg.data as Record<string, unknown>
      if (data.event === 'deleted') {
        set({ rules: get().rules.filter(r => r.id !== ruleId) })
      } else {
        set({
          rules: get().rules.map(r => r.id === ruleId ? { ...r, ...data } : r),
        })
      }
    })
    return off
  },
}))
