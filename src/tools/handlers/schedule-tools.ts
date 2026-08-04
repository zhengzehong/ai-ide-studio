import type { ToolHandler } from '../types.js'
import { ruleStore } from '../../store/rules.js'
import { ruleExecutionStore } from '../../store/rule-executions.js'
import { getNextRunTime, validateCronFields } from '../../core/cron.js'
import { events } from '../../core/events.js'
import { resolveSessionMode, validateTaskAssignment } from '../../core/tasks.js'

function validateCronFormat(cron: string): boolean {
  try {
    validateCronFields(cron)
    return true
  } catch {
    return false
  }
}

function cronDescription(cron: string): string {
  const [min, hour, dom, , dow] = cron.trim().split(/\s+/)
  if (min === '*' && hour === '*') return '每分钟'
  if (min === '0' && hour === '*') return '每小时整点'
  if (min !== '*' && hour !== '*' && dom === '*' && dow === '*') return `每天 ${hour}:${min.padStart(2, '0')}`
  if (dow !== '*' && dom === '*') return `每周 ${dow} 的 ${hour}:${min.padStart(2, '0')}`
  return cron
}

function checkOwnership(ruleId: string, agentId: string): void {
  const rule = ruleStore.get(ruleId)
  if (!rule) throw new Error(`规则不存在: ${ruleId}`)
  if (rule.created_by && rule.created_by !== `agent:${agentId}`) {
    throw new Error('权限不足：只能管理自己创建的规则')
  }
}

export const scheduleCreateHandler: ToolHandler = {
  name: 'studio.schedule.create',
  description: '为当前 Agent 的当前会话创建定时 Prompt。不会创建任务或新会话。',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '定时规则名称' },
      cron: { type: 'string', description: '5 段 Cron 表达式（分 时 日 月 周），按本地时间执行' },
      prompt: { type: 'string', description: '到时间后注入当前会话的 Prompt' },
    },
    required: ['name', 'cron', 'prompt'],
  },
  async execute(input, context) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const cron = typeof input.cron === 'string' ? input.cron.trim() : ''
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    const agentId = context?.agentId
    const sessionId = context?.sessionId

    if (!name || !cron || !prompt) {
      return toolError('name、cron、prompt 均为必填项')
    }
    if (!agentId || !sessionId) {
      return toolError('当前工具需要绑定当前 Agent 和当前会话')
    }
    if (!validateCronFormat(cron)) {
      return toolError('cron 表达式格式无效，需要 5 个字段：分 时 日 月 周')
    }

    try {
      validateTaskAssignment(agentId, context?.projectId, sessionId)
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error))
    }

    const rule = ruleStore.create({
      name,
      cron,
      action: 'send_prompt',
      actionConfig: {
        prompt,
        agent_id: agentId,
        session_mode: 'existing',
        session_id: sessionId,
      },
      enabled: true,
      projectId: context?.projectId,
      createdBy: `agent:${agentId}`,
    })

    const nextRun = getNextRunTime(rule.cron, new Date())
    if (nextRun) {
      ruleStore.update(rule.id, { next_run_at: nextRun.toISOString() })
      rule.next_run_at = nextRun.toISOString()
    }

    events.emit('rule:update', { ruleId: rule.id, data: { ...rule } })

    return {
      content: [{ type: 'text', text: JSON.stringify({
        ruleId: rule.id,
        name: rule.name,
        cron: rule.cron,
        cronDescription: cronDescription(rule.cron),
        nextRunAt: rule.next_run_at,
        enabled: rule.enabled,
      }, null, 2) }],
    }
  },
}

function toolError(error: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: JSON.stringify({ error }) }], isError: true }
}

export const scheduleListHandler: ToolHandler = {
  name: 'studio.schedule.list',
  description: '查看当前项目的定时规则列表。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '项目 ID，不传用当前会话项目' },
      enabled: { type: 'boolean', description: '按启用状态过滤' },
    },
  },
  async execute(input, context) {
    const projectId = (input.projectId as string) || context?.projectId
    let rules = ruleStore.list(projectId)
    if (input.enabled !== undefined) {
      rules = rules.filter(r => r.enabled === input.enabled)
    }
    const summary = rules.map(r => ({
      id: r.id,
      name: r.name,
      cron: r.cron,
      cronDescription: cronDescription(r.cron),
      action: r.action,
      enabled: r.enabled,
      runCount: r.run_count,
      failCount: r.fail_count,
      lastRunAt: r.last_run_at,
      nextRunAt: r.next_run_at,
    }))
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] }
  },
}

export const scheduleUpdateHandler: ToolHandler = {
  name: 'studio.schedule.update',
  description: '修改一条定时规则。只能修改自己创建的规则。',
  inputSchema: {
    type: 'object',
    properties: {
      ruleId: { type: 'string', description: '规则 ID' },
      name: { type: 'string' },
      cron: { type: 'string' },
      enabled: { type: 'boolean' },
      taskTitle: { type: 'string' },
      taskDescription: { type: 'string' },
      assignAgentId: { type: 'string' },
      sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'] },
      sessionId: { type: 'string' },
      maxRuns: { type: 'number' },
    },
    required: ['ruleId'],
  },
  async execute(input, context) {
    const ruleId = input.ruleId as string
    checkOwnership(ruleId, context?.agentId ?? '')

    if (input.cron && !validateCronFormat(input.cron as string)) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'cron 表达式格式无效' }) }] }
    }

    const fields: Record<string, unknown> = {}
    if (input.name !== undefined) fields.name = input.name
    if (input.cron !== undefined) fields.cron = (input.cron as string).trim()
    if (input.enabled !== undefined) fields.enabled = input.enabled
    if (input.maxRuns !== undefined) fields.max_runs = input.maxRuns
    if (input.taskTitle !== undefined || input.taskDescription !== undefined || input.assignAgentId !== undefined || input.sessionMode !== undefined || input.sessionId !== undefined) {
      const rule = ruleStore.get(ruleId)!
      const nextSessionId = input.sessionId !== undefined ? input.sessionId as string : rule.action_config.session_id ?? undefined
      fields.action_config = {
        ...rule.action_config,
        ...(input.taskTitle !== undefined ? { title: input.taskTitle } : {}),
        ...(input.taskDescription !== undefined ? { description: input.taskDescription } : {}),
        ...(input.assignAgentId !== undefined ? { assign_agent_id: input.assignAgentId } : {}),
        ...(input.sessionMode !== undefined ? { session_mode: resolveSessionMode(input.sessionMode, nextSessionId) } : {}),
        ...(input.sessionId !== undefined ? { session_id: input.sessionId } : {}),
      }
    }

    ruleStore.update(ruleId, fields)

    if (fields.cron || input.enabled !== undefined) {
      const rule = ruleStore.get(ruleId)
      if (rule && rule.enabled) {
        const nextRun = getNextRunTime(rule.cron, new Date())
        ruleStore.update(ruleId, { next_run_at: nextRun?.toISOString() ?? null })
      }
    }

    const updated = ruleStore.get(ruleId)
    if (updated) events.emit('rule:update', { ruleId, data: { ...updated } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, rule: updated }) }] }
  },
}

export const scheduleDeleteHandler: ToolHandler = {
  name: 'studio.schedule.delete',
  description: '删除一条定时规则。只能删除自己创建的规则。',
  inputSchema: {
    type: 'object',
    properties: {
      ruleId: { type: 'string', description: '规则 ID' },
    },
    required: ['ruleId'],
  },
  async execute(input, context) {
    const ruleId = input.ruleId as string
    checkOwnership(ruleId, context?.agentId ?? '')
    ruleStore.delete(ruleId)
    events.emit('rule:update', { ruleId, data: { event: 'deleted' } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, deleted: ruleId }) }] }
  },
}

export const scheduleToggleHandler: ToolHandler = {
  name: 'studio.schedule.toggle',
  description: '启用或禁用一条定时规则。只能操作自己创建的规则。',
  inputSchema: {
    type: 'object',
    properties: {
      ruleId: { type: 'string', description: '规则 ID' },
      enabled: { type: 'boolean', description: '启用=true，禁用=false' },
    },
    required: ['ruleId', 'enabled'],
  },
  async execute(input, context) {
    const ruleId = input.ruleId as string
    checkOwnership(ruleId, context?.agentId ?? '')
    ruleStore.toggle(ruleId, input.enabled as boolean)

    if (input.enabled) {
      const rule = ruleStore.get(ruleId)
      if (rule) {
        const nextRun = getNextRunTime(rule.cron, new Date())
        if (nextRun) ruleStore.update(ruleId, { next_run_at: nextRun.toISOString() })
      }
    }

    events.emit('rule:update', { ruleId, data: { event: 'toggled', enabled: input.enabled } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, enabled: input.enabled }) }] }
  },
}

export const scheduleExecutionsHandler: ToolHandler = {
  name: 'studio.schedule.executions',
  description: '查看某条定时规则的执行历史记录。',
  inputSchema: {
    type: 'object',
    properties: {
      ruleId: { type: 'string', description: '规则 ID' },
      limit: { type: 'number', description: '返回条数，默认 20' },
    },
    required: ['ruleId'],
  },
  async execute(input) {
    const ruleId = input.ruleId as string
    const limit = (input.limit as number) || 20
    const executions = ruleExecutionStore.listByRule(ruleId, limit)
    return { content: [{ type: 'text', text: JSON.stringify(executions, null, 2) }] }
  },
}
