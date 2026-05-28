import type { ToolHandler, ToolHandlerInput, ToolContext, ToolHandlerResult } from '../types.js'

async function executeCreateTask(input: ToolHandlerInput, context: ToolContext, legacy = false): Promise<ToolHandlerResult> {
  const { taskManager } = await import('../../core/tasks.js')
  const task = await taskManager.createTask({
    title: requireString(input, 'title'),
    description: optionalString(input, 'description'),
    source: 'agent',
    assignAgentId: optionalString(input, 'assignAgentId'),
    projectId: optionalString(input, 'projectId') ?? context.projectId,
  })
  const output = legacy ? { taskId: task.id, title: task.title, status: task.status } : { task }
  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  }
}

const createTaskSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    assignAgentId: { type: 'string' },
    projectId: { type: 'string' },
  },
  required: ['title'],
}

export const legacyCreateTaskHandler: ToolHandler = {
  name: 'create_task',
  description: '创建任务并可选分派 Agent',
  inputSchema: createTaskSchema,
  execute: (input, context) => executeCreateTask(input, context, true),
}

export const createTaskHandler: ToolHandler = {
  name: 'core.task.create',
  description: '在当前项目中创建任务并可选分派 Agent',
  inputSchema: createTaskSchema,
  execute: executeCreateTask,
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}
