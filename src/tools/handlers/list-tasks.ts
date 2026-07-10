import { taskStore } from '../../store/tasks.js'
import type { ToolHandler } from '../types.js'

export const listTasksHandler: ToolHandler = {
  name: 'core.task.list',
  description: '列出当前项目的任务',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: '可选任务状态过滤' },
      projectId: { type: 'string', description: '项目 ID；不传时使用当前会话项目' },
    },
  },
  async execute(input, context) {
    const status = typeof input.status === 'string' ? input.status : undefined
    const projectId = context.projectId ?? (typeof input.projectId === 'string' ? input.projectId : undefined)
    const tasks = taskStore
      .list(status, projectId)
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    return {
      content: [{ type: 'text', text: JSON.stringify({ tasks }, null, 2) }],
    }
  },
}
