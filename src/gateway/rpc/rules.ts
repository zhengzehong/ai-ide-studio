import { events } from '../../core/events.js'
import { getNextRunTime } from '../../core/cron.js'
import { ruleStore } from '../../store/rules.js'
import type { RpcHandlerMap } from './types.js'

type RuleActionConfig = { title: string; description?: string; assignAgentId?: string; assign_agent_id?: string }

function validateCron(cron: string): string {
  const normalized = cron.trim()
  if (normalized.split(/\s+/).length !== 5) throw new Error('cron 表达式需要 5 个字段')
  return normalized
}

export const ruleRpcHandlers: RpcHandlerMap = {
  'rules.list'(_msg, { sendResult }) {
    sendResult(ruleStore.list())
  },

  'rules.create'(msg, { sendResult }) {
    const name = msg.name as string
    const cron = msg.cron as string
    const action = msg.action as string
    const actionConfig = msg.actionConfig as RuleActionConfig
    if (!name || !cron || !action || !actionConfig?.title) throw new Error('name, cron, action 和 actionConfig.title 为必填项')
    const rule = ruleStore.create({
      name,
      cron: validateCron(cron),
      action,
      actionConfig,
      description: msg.description as string | undefined,
      enabled: msg.enabled !== false,
    })
    const nextRun = getNextRunTime(rule.cron, new Date())
    if (nextRun) {
      ruleStore.update(rule.id, { next_run_at: nextRun.toISOString() })
      rule.next_run_at = nextRun.toISOString()
    }
    events.emit('rule:update', { ruleId: rule.id, data: { ...rule } })
    sendResult(rule)
  },

  'rules.update'(msg, { sendResult }) {
    const fields: Record<string, unknown> = {}
    if (msg.name !== undefined) fields.name = msg.name
    if (msg.cron !== undefined) fields.cron = validateCron(msg.cron as string)
    if (msg.action !== undefined) fields.action = msg.action
    if (msg.actionConfig !== undefined) {
      const actionConfig = msg.actionConfig as RuleActionConfig
      fields.action_config = actionConfig.assign_agent_id !== undefined
        ? { ...actionConfig, assignAgentId: actionConfig.assign_agent_id }
        : actionConfig
    }
    if (msg.description !== undefined) fields.description = msg.description
    if (msg.enabled !== undefined) fields.enabled = msg.enabled
    ruleStore.update(msg.ruleId as string, fields)
    if (fields.cron) {
      const rule = ruleStore.get(msg.ruleId as string)
      if (rule) {
        const nextRun = getNextRunTime(rule.cron, new Date())
        ruleStore.update(rule.id, { next_run_at: nextRun?.toISOString() ?? null })
      }
    }
    const updated = ruleStore.get(msg.ruleId as string)
    if (updated) events.emit('rule:update', { ruleId: updated.id, data: { ...updated } })
    sendResult(updated)
  },

  'rules.toggle'(msg, { sendResult }) {
    ruleStore.toggle(msg.ruleId as string, msg.enabled as boolean)
    events.emit('rule:update', { ruleId: msg.ruleId as string, data: { event: 'toggled', enabled: msg.enabled } })
    sendResult(ruleStore.get(msg.ruleId as string))
  },

  'rules.delete'(msg, { sendResult }) {
    ruleStore.delete(msg.ruleId as string)
    events.emit('rule:update', { ruleId: msg.ruleId as string, data: { event: 'deleted' } })
    sendResult({ deleted: true })
  },
}
