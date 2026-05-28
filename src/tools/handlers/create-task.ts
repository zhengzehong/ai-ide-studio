import type { ToolHandler, ToolHandlerInput, ToolContext, ToolHandlerResult } from '../types.js'

async function executeCreateTask(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
  const { taskManager } = await import('../../core/tasks.js')
  const task = await taskManager.createTask({
    title: input.title as string,
    description: input.description as string | undefined,
    source: 'agent',
    assignAgentId: input.assignAgentId as string | undefined,
    projectId: context.projectId,
  })
  return {
    content: [{ type: 'text', text: JSON.stringify({ taskId: task.id, title: task.title, status: task.status }, null, 2) }],
  }
}

const createTaskSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    assignAgentId: { type: 'string' },
  },
  required: ['title'],
}

export const legacyCreateTaskHandler: ToolHandler = {
  name: 'create_task',
  description: '创建任务并可选分派 Agent',
  inputSchema: createTaskSchema,
  execute: executeCreateTask,
}

export const createTaskHandler: ToolHandler = {
  name: 'core.task.create',
  description: '在当前项目中创建任务并可选分派 Agent',
  inputSchema: createTaskSchema,
  execute: executeCreateTask,
}
