import { events } from '../../core/events.js'
import { getNextRunTime } from '../../core/cron.js'
import { ruleStore } from '../../store/rules.js'
import { ruleExecutionStore } from '../../store/rule-executions.js'
import { ruleEngine } from '../../core/rules.js'
import type { RpcHandlerMap } from './types.js'

function validateCron(cron: string): string {
  const normalized = cron.trim()
  if (normalized.split(/\s+/).length !== 5) throw new Error('cron 表达式需要 5 个字段')
  return normalized
}

export const ruleRpcHandlers: RpcHandlerMap = {
  'rules.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    sendResult(ruleStore.list(projectId))
  },

  'rules.create'(msg, { sendResult }) {
    const name = msg.name as string
    const cron = msg.cron as string
    const action = (msg.action as string) || 'create_task'
    const actionConfig = msg.actionConfig as Record<string, unknown>
    if (!name || !cron) throw new Error('name 和 cron 为必填项')

    if (action === 'create_task' && !actionConfig?.title) {
      throw new Error('action=create_task 时 actionConfig.title 为必填')
    }
    if (action === 'send_prompt' && (!actionConfig?.prompt || !actionConfig?.agent_id)) {
      throw new Error('action=send_prompt 时 actionConfig.prompt 和 actionConfig.agent_id 为必填')
    }

    const rule = ruleStore.create({
      name,
      cron: validateCron(cron),
      action,
      actionConfig: actionConfig ?? {},
      description: msg.description as string | undefined,
      enabled: msg.enabled !== false,
      projectId: msg.projectId as string | undefined,
      maxRuns: msg.maxRuns as number | undefined,
      createdBy: msg.createdBy as string | undefined,
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
    const ruleId = msg.ruleId as string
    if (!ruleId) throw new Error('ruleId 为必填')

    const fields: Record<string, unknown> = {}
    if (msg.name !== undefined) fields.name = msg.name
    if (msg.cron !== undefined) fields.cron = validateCron(msg.cron as string)
    if (msg.action !== undefined) fields.action = msg.action
    if (msg.actionConfig !== undefined) fields.action_config = msg.actionConfig
    if (msg.description !== undefined) fields.description = msg.description
    if (msg.enabled !== undefined) fields.enabled = msg.enabled
    if (msg.maxRuns !== undefined) fields.max_runs = msg.maxRuns

    ruleStore.update(ruleId, fields)

    if (fields.cron || msg.enabled !== undefined) {
      const rule = ruleStore.get(ruleId)
      if (rule && rule.enabled) {
        const nextRun = getNextRunTime(rule.cron, new Date())
        ruleStore.update(rule.id, { next_run_at: nextRun?.toISOString() ?? null })
      }
    }

    const updated = ruleStore.get(ruleId)
    if (updated) events.emit('rule:update', { ruleId: updated.id, data: { ...updated } })
    sendResult(updated)
  },

  'rules.toggle'(msg, { sendResult }) {
    const ruleId = msg.ruleId as string
    const enabled = msg.enabled as boolean
    ruleStore.toggle(ruleId, enabled)

    if (enabled) {
      const rule = ruleStore.get(ruleId)
      if (rule) {
        const nextRun = getNextRunTime(rule.cron, new Date())
        if (nextRun) ruleStore.update(ruleId, { next_run_at: nextRun.toISOString() })
      }
    }

    events.emit('rule:update', { ruleId, data: { event: 'toggled', enabled } })
    sendResult(ruleStore.get(ruleId))
  },

  'rules.delete'(msg, { sendResult }) {
    ruleStore.delete(msg.ruleId as string)
    events.emit('rule:update', { ruleId: msg.ruleId as string, data: { event: 'deleted' } })
    sendResult({ deleted: true })
  },

  'rules.executions'(msg, { sendResult }) {
    const ruleId = msg.ruleId as string
    if (!ruleId) throw new Error('ruleId 为必填')
    const limit = (msg.limit as number) || 20
    sendResult(ruleExecutionStore.listByRule(ruleId, limit))
  },

  'rules.runNow'(msg, { sendResult, sendError }) {
    const ruleId = msg.ruleId as string
    if (!ruleId) throw new Error('ruleId 为必填')
    ruleEngine.runNow(ruleId)
      .then(() => sendResult({ ok: true }))
      .catch((err) => sendError(err instanceof Error ? err.message : String(err)))
  },
}
