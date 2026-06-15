import type { ToolHandler } from '../types.js'
import { getNextRunTime } from '../../core/cron.js'
import { events } from '../../core/events.js'

export const createScheduleHandler: ToolHandler = {
  name: 'create_schedule',
  description: '创建 cron 定时规则（兼容旧版，推荐使用 core.schedule.create）',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      cron: { type: 'string' },
      taskTitle: { type: 'string' },
      taskDescription: { type: 'string' },
      assignAgentId: { type: 'string' },
      sessionId: { type: 'string' },
    },
    required: ['name', 'cron', 'taskTitle'],
  },
  async execute(input, context) {
    const { ruleStore } = await import('../../store/rules.js')

    const cron = (input.cron as string).trim()
    if (cron.split(/\s+/).length !== 5) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'cron 表达式需要 5 个字段' }) }] }
    }

    const rule = ruleStore.create({
      name: input.name as string,
      cron,
      action: 'create_task',
      actionConfig: {
        title: input.taskTitle as string,
        description: input.taskDescription as string | undefined,
        assign_agent_id: input.assignAgentId as string | undefined,
        session_id: input.sessionId as string | undefined,
      },
      enabled: true,
      projectId: context?.projectId,
      createdBy: context?.agentId ? `agent:${context.agentId}` : 'human',
    })

    const nextRun = getNextRunTime(rule.cron, new Date())
    if (nextRun) {
      ruleStore.update(rule.id, { next_run_at: nextRun.toISOString() })
      rule.next_run_at = nextRun.toISOString()
    }

    events.emit('rule:update', { ruleId: rule.id, data: { ...rule } })

    return {
      content: [{ type: 'text', text: JSON.stringify({ ruleId: rule.id, name: rule.name, cron: rule.cron, nextRunAt: rule.next_run_at }, null, 2) }],
    }
  },
}
