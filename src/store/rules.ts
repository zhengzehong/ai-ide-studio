import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface RuleRow {
  id: string
  name: string
  description: string | null
  cron: string
  action: string
  action_config: {
    title?: string
    description?: string
    assign_agent_id?: string
    prompt_template?: string
    prompt?: string
    agent_id?: string
    session_id?: string | null
    session_mode?: 'existing' | 'new_each' | 'new_fixed'
  }
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

interface RuleSqlRow {
  id: string
  name: string
  description: string | null
  cron: string
  action: string
  action_config_json: string
  enabled: number
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

export interface CreateRuleInput {
  name: string
  cron: string
  action: string
  actionConfig: Record<string, unknown>
  description?: string
  enabled?: boolean
  projectId?: string
  maxRuns?: number
  createdBy?: string
  triggerType?: string
}

export const ruleStore = {
  create(input: CreateRuleInput): RuleRow {
    const now = new Date().toISOString()
    const rule: RuleRow = {
      id: `rule-${randomUUID().slice(0, 8)}`,
      name: input.name,
      description: input.description || null,
      cron: input.cron,
      action: input.action,
      action_config: input.actionConfig as RuleRow['action_config'],
      enabled: input.enabled !== false,
      last_run_at: null,
      last_fail_at: null,
      next_run_at: null,
      run_count: 0,
      fail_count: 0,
      max_runs: input.maxRuns ?? null,
      created_by: input.createdBy ?? null,
      trigger_type: input.triggerType ?? 'cron',
      created_at: now,
      updated_at: now,
      project_id: input.projectId ?? null,
    }
    getDb().prepare(`
      INSERT INTO rules (id, name, description, cron, action, action_config_json, enabled, last_run_at, last_fail_at, next_run_at, run_count, fail_count, max_runs, created_by, trigger_type, created_at, updated_at, project_id)
      VALUES (@id, @name, @description, @cron, @action, @action_config_json, @enabled, @last_run_at, @last_fail_at, @next_run_at, @run_count, @fail_count, @max_runs, @created_by, @trigger_type, @created_at, @updated_at, @project_id)
    `).run(toSqlRule(rule))
    return rule
  },

  get(id: string): RuleRow | undefined {
    const row = getDb().prepare<[string], RuleSqlRow>('SELECT * FROM rules WHERE id = ?').get(id)
    return row ? fromSqlRule(row) : undefined
  },

  list(projectId?: string): RuleRow[] {
    if (projectId) {
      return getDb().prepare<[string], RuleSqlRow>('SELECT * FROM rules WHERE project_id = ? ORDER BY created_at ASC').all(projectId).map(fromSqlRule)
    }
    return getDb().prepare<[], RuleSqlRow>('SELECT * FROM rules ORDER BY created_at ASC').all().map(fromSqlRule)
  },

  update(id: string, fields: Partial<RuleRow>): void {
    const rule = ruleStore.get(id)
    if (!rule) return
    const updated: RuleRow = {
      ...rule,
      ...fields,
      action_config: fields.action_config ? { ...rule.action_config, ...fields.action_config } : rule.action_config,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE rules
      SET name = @name,
          description = @description,
          cron = @cron,
          action = @action,
          action_config_json = @action_config_json,
          enabled = @enabled,
          last_run_at = @last_run_at,
          last_fail_at = @last_fail_at,
          next_run_at = @next_run_at,
          run_count = @run_count,
          fail_count = @fail_count,
          max_runs = @max_runs,
          created_by = @created_by,
          trigger_type = @trigger_type,
          updated_at = @updated_at,
          project_id = @project_id
      WHERE id = @id
    `).run(toSqlRule(updated))
  },

  toggle(id: string, enabled: boolean): void {
    getDb().prepare('UPDATE rules SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, new Date().toISOString(), id)
  },

  recordRun(id: string, lastRunAt: string, nextRunAt: string | null): void {
    getDb().prepare(`
      UPDATE rules
      SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1, updated_at = ?
      WHERE id = ?
    `).run(lastRunAt, nextRunAt, new Date().toISOString(), id)
  },

  recordFail(id: string, failAt: string, nextRunAt: string | null): void {
    getDb().prepare(`
      UPDATE rules
      SET last_fail_at = ?, next_run_at = ?, fail_count = fail_count + 1, updated_at = ?
      WHERE id = ?
    `).run(failAt, nextRunAt, new Date().toISOString(), id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM rules WHERE id = ?').run(id)
  },
}

function toSqlRule(rule: RuleRow): RuleSqlRow {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    cron: rule.cron,
    action: rule.action,
    action_config_json: JSON.stringify(rule.action_config),
    enabled: rule.enabled ? 1 : 0,
    last_run_at: rule.last_run_at,
    last_fail_at: rule.last_fail_at,
    next_run_at: rule.next_run_at,
    run_count: rule.run_count,
    fail_count: rule.fail_count,
    max_runs: rule.max_runs,
    created_by: rule.created_by,
    trigger_type: rule.trigger_type,
    created_at: rule.created_at,
    updated_at: rule.updated_at,
    project_id: rule.project_id,
  }
}

function fromSqlRule(row: RuleSqlRow): RuleRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cron: row.cron,
    action: row.action,
    action_config: parseActionConfig(row.action_config_json),
    enabled: Boolean(row.enabled),
    last_run_at: row.last_run_at,
    last_fail_at: row.last_fail_at,
    next_run_at: row.next_run_at,
    run_count: row.run_count,
    fail_count: row.fail_count ?? 0,
    max_runs: row.max_runs,
    created_by: row.created_by,
    trigger_type: row.trigger_type ?? 'cron',
    created_at: row.created_at,
    updated_at: row.updated_at,
    project_id: row.project_id,
  }
}

function parseActionConfig(raw: string): RuleRow['action_config'] {
  try {
    const parsed = JSON.parse(raw) as RuleRow['action_config'] & { assignAgentId?: string }
    if (parsed.assignAgentId && !parsed.assign_agent_id) {
      parsed.assign_agent_id = parsed.assignAgentId
      delete (parsed as Record<string, unknown>).assignAgentId
    }
    return parsed
  } catch {
    return {}
  }
}
