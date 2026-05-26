import { randomUUID } from 'crypto'
import { getData, persist } from './db.js'

export interface RuleRow {
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

export interface CreateRuleInput {
  name: string
  cron: string
  action: string
  actionConfig: { title: string; description?: string; assignAgentId?: string }
  description?: string
  enabled?: boolean
}

export const ruleStore = {
  create(input: CreateRuleInput): RuleRow {
    const data = getData()
    const id = `rule-${randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()
    const rule: RuleRow = {
      id,
      name: input.name,
      description: input.description || null,
      cron: input.cron,
      action: input.action,
      action_config: {
        title: input.actionConfig.title,
        description: input.actionConfig.description,
        assign_agent_id: input.actionConfig.assignAgentId,
      },
      enabled: input.enabled !== false,
      last_run_at: null,
      next_run_at: null,
      run_count: 0,
      created_at: now,
      updated_at: now,
    }
    data.rules[id] = rule
    persist()
    return rule
  },

  get(id: string): RuleRow | undefined {
    const data = getData()
    return data.rules[id] as RuleRow | undefined
  },

  list(): RuleRow[] {
    const data = getData()
    return Object.values(data.rules) as RuleRow[]
  },

  update(id: string, fields: Partial<RuleRow>): void {
    const data = getData()
    const rule = data.rules[id] as RuleRow | undefined
    if (!rule) return
    if (fields.action_config) {
      rule.action_config = { ...rule.action_config, ...fields.action_config }
      delete fields.action_config
    }
    Object.assign(rule, fields, { updated_at: new Date().toISOString() })
    persist()
  },

  toggle(id: string, enabled: boolean): void {
    const data = getData()
    const rule = data.rules[id] as RuleRow | undefined
    if (!rule) return
    rule.enabled = enabled
    rule.updated_at = new Date().toISOString()
    persist()
  },

  recordRun(id: string, lastRunAt: string, nextRunAt: string | null): void {
    const data = getData()
    const rule = data.rules[id] as RuleRow | undefined
    if (!rule) return
    rule.last_run_at = lastRunAt
    rule.next_run_at = nextRunAt
    rule.run_count += 1
    persist()
  },

  delete(id: string): void {
    const data = getData()
    delete data.rules[id]
    persist()
  },
}
