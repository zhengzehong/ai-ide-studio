import type { ToolHandler } from '../types.js'

export const createScheduleHandler: ToolHandler = {
  name: 'create_schedule',
  description: '创建 cron 定时规则',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      cron: { type: 'string' },
      taskTitle: { type: 'string' },
      taskDescription: { type: 'string' },
      assignAgentId: { type: 'string' },
    },
    required: ['name', 'cron', 'taskTitle'],
  },
  async execute(input) {
    const { ruleStore } = await import('../../store/rules.js')
    const rule = ruleStore.create({
      name: input.name as string,
      cron: input.cron as string,
      action: 'create_task',
      actionConfig: {
        title: input.taskTitle as string,
        description: input.taskDescription as string | undefined,
        assignAgentId: input.assignAgentId as string | undefined,
      },
      enabled: true,
    })
    return {
      content: [{ type: 'text', text: JSON.stringify({ ruleId: rule.id, name: rule.name, cron: rule.cron }, null, 2) }],
    }
  },
}
