import type { ToolHandler } from '../types.js'

export const createTaskHandler: ToolHandler = {
  name: 'create_task',
  description: '创建任务并可选分派 Agent',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      assignAgentId: { type: 'string' },
    },
    required: ['title'],
  },
  async execute(input) {
    const { taskManager } = await import('../../core/tasks.js')
    const task = await taskManager.createTask({
      title: input.title as string,
      description: input.description as string | undefined,
      source: 'agent',
      assignAgentId: input.assignAgentId as string | undefined,
    })
    return {
      content: [{ type: 'text', text: JSON.stringify({ taskId: task.id, title: task.title, status: task.status }, null, 2) }],
    }
  },
}
