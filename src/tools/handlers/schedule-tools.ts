import type { ToolHandler } from '../types.js'
import { ruleStore } from '../../store/rules.js'
import { ruleExecutionStore } from '../../store/rule-executions.js'
import { getNextRunTime, matchCron } from '../../core/cron.js'
import { events } from '../../core/events.js'

function validateCronFormat(cron: string): boolean {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return false
  try {
    matchCron(cron, new Date())
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
  description: '创建一个 cron 定时规则。支持创建任务或发送 Prompt 两种动作。',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '规则名称' },
      cron: { type: 'string', description: '5 字段 cron 表达式（分 时 日 月 周）' },
      action: { type: 'string', description: '动作类型：create_task 或 send_prompt，默认 create_task' },
      taskTitle: { type: 'string', description: 'action=create_task 时必填：任务标题' },
      taskDescription: { type: 'string', description: '任务描述' },
      assignAgentId: { type: 'string', description: '指派的 Agent ID' },
      promptTemplate: { type: 'string', description: '自定义 prompt 模板' },
      prompt: { type: 'string', description: 'action=send_prompt 时必填：发送的 prompt 内容' },
      agentId: { type: 'string', description: 'action=send_prompt 时必填：目标 Agent' },
      maxRuns: { type: 'number', description: '最大执行次数，不传则不限' },
      projectId: { type: 'string', description: '所属项目 ID，不传用当前会话项目' },
    },
    required: ['name', 'cron'],
  },
  async execute(input, context) {
    const cron = (input.cron as string).trim()
    if (!validateCronFormat(cron)) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'cron 表达式格式无效，需要 5 个字段：分 时 日 月 周' }) }] }
    }

    const action = (input.action as string) || 'create_task'
    let actionConfig: Record<string, unknown> = {}

    if (action === 'create_task') {
      if (!input.taskTitle) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'action=create_task 时 taskTitle 为必填' }) }] }
      }
      actionConfig = {
        title: input.taskTitle,
        description: input.taskDescription,
        assign_agent_id: input.assignAgentId,
        prompt_template: input.promptTemplate,
      }
    } else if (action === 'send_prompt') {
      if (!input.prompt || !input.agentId) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'action=send_prompt 时 prompt 和 agentId 为必填' }) }] }
      }
      actionConfig = {
        prompt: input.prompt,
        agent_id: input.agentId,
      }
    }

    const projectId = (input.projectId as string) || context?.projectId
    const rule = ruleStore.create({
      name: input.name as string,
      cron,
      action,
      actionConfig,
      enabled: true,
      projectId,
      maxRuns: input.maxRuns as number | undefined,
      createdBy: context?.agentId ? `agent:${context.agentId}` : 'human',
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
    if (input.taskTitle !== undefined || input.taskDescription !== undefined || input.assignAgentId !== undefined) {
      const rule = ruleStore.get(ruleId)!
      fields.action_config = {
        ...rule.action_config,
        ...(input.taskTitle !== undefined ? { title: input.taskTitle } : {}),
        ...(input.taskDescription !== undefined ? { description: input.taskDescription } : {}),
        ...(input.assignAgentId !== undefined ? { assign_agent_id: input.assignAgentId } : {}),
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
