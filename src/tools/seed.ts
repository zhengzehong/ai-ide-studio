import { toolStore, toolBindingStore } from '../store/tools.js'
import { createChildLogger } from '../core/logger.js'
import type { CreateToolInput } from '../store/tools.js'

const log = createChildLogger('tool-seed')

const BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  {
    name: 'core.task.list',
    displayName: '列出任务',
    description: '列出当前项目中的任务。可选输入 status 过滤任务状态。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.task.list' },
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '任务状态过滤' },
      },
    },
    permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.task.create',
    displayName: '创建任务',
    description: '在当前项目中创建一个新的任务并可选分派给指定 Agent 执行。输入 title（必填）、description（可选）、assignAgentId（可选）。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.task.create' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务描述' },
        assignAgentId: { type: 'string', description: '指派的 Agent ID' },
      },
      required: ['title'],
    },
    permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'create_task',
    displayName: '创建任务',
    description: '创建一个新的任务并可选分派给指定 Agent 执行。输入 title（必填）、description（可选）、assignAgentId（可选）。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'createTask' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务描述' },
        assignAgentId: { type: 'string', description: '指派的 Agent ID' },
      },
      required: ['title'],
    },
    permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'create_schedule',
    displayName: '创建定时任务',
    description: '创建一个 cron 定时规则，自动在指定时间触发任务创建。输入 name、cron（5 字段表达式）、taskTitle。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'createSchedule' },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '规则名称' },
        cron: { type: 'string', description: 'Cron 表达式 (5 字段)' },
        taskTitle: { type: 'string', description: '任务标题' },
        taskDescription: { type: 'string', description: '任务描述' },
        assignAgentId: { type: 'string', description: '指派的 Agent ID' },
      },
      required: ['name', 'cron', 'taskTitle'],
    },
    permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
    isBuiltin: true,
    defaultScope: 'global',
  },
]

export function seedBuiltinTools(): void {
  const existing = toolStore.list().filter(t => t.is_builtin)
  if (existing.length >= BUILTIN_TOOLS.length) return

  const existingNames = new Set(existing.map(t => t.name))

  for (const def of BUILTIN_TOOLS) {
    if (existingNames.has(def.name)) continue

    const tool = toolStore.create(def)
    toolBindingStore.set(tool.id, 'global', null)
  }

  log.info({ count: BUILTIN_TOOLS.length - existingNames.size }, '内置工具已初始化')
}
