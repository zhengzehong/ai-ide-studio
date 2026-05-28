import { taskStore } from '../../store/tasks.js'
import type { ToolHandler } from '../types.js'

export const listTasksHandler: ToolHandler = {
  name: 'core.task.list',
  description: '列出当前项目的任务',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: '可选任务状态过滤' },
    },
  },
  async execute(input, context) {
    const tasks = taskStore.list(input.status as string | undefined, context.projectId)
    return {
      content: [{ type: 'text', text: JSON.stringify({ tasks }, null, 2) }],
    }
  },
}
