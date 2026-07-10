import type { ToolHandler, ToolHandlerInput, ToolContext, ToolHandlerResult } from '../types.js'

async function executeCreateTask(
  input: ToolHandlerInput,
  context: ToolContext,
  legacy = false,
): Promise<ToolHandlerResult> {
  const { resolveSessionMode, taskManager, validateSessionModeTarget, validateTaskAssignment } =
    await import('../../core/tasks.js')
  const sessionId = optionalString(input, 'sessionId')
  const assignAgentId = optionalString(input, 'assignAgentId')
  const sessionMode = resolveSessionMode(input.sessionMode, sessionId)
  const projectId = context.projectId ?? optionalString(input, 'projectId')
  if (assignAgentId) {
    validateSessionModeTarget(sessionMode, sessionId)
    validateTaskAssignment(
      assignAgentId,
      projectId,
      sessionMode === 'existing' || (sessionMode === 'new_fixed' && sessionId) ? sessionId : undefined,
    )
  }
  const task = await taskManager.createTask({
    title: requireString(input, 'title'),
    description: optionalString(input, 'description') ?? requireString(input, 'title'),
    source: 'agent',
    projectId,
  })
  if (!task) throw new Error('任务创建失败')
  const result = assignAgentId
    ? await taskManager.assignTask({ taskId: task.id, agentId: assignAgentId, sessionId, sessionMode })
    : task
  const output = legacy ? { taskId: result.id, title: result.title, status: result.status } : { task: result }
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
    sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'] },
    sessionId: { type: 'string' },
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
