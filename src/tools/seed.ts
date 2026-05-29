import { getDb } from '../store/db.js'
import { toolStore, toolBindingStore } from '../store/tools.js'
import { createChildLogger } from '../core/logger.js'
import type { CreateToolInput } from '../store/tools.js'
import { TEAM_BUILTIN_TOOLS } from './team-seed.js'

const log = createChildLogger('tool-seed')

const CORE_PERMISSIONS = { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false }
const OBSOLETE_BUILTIN_TOOLS = ['search_files', 'get_project_info', 'list_agents', 'http_fetch']

const CORE_BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  {
    name: 'core.project.list',
    displayName: '列出项目',
    description: '列出平台中的项目。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.project.list' },
    inputSchema: { type: 'object', properties: {} },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.project.get',
    displayName: '获取项目',
    description: '按 projectId 获取项目详情。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.project.get' },
    inputSchema: { type: 'object', properties: { projectId: { type: 'string', description: '项目 ID' } }, required: ['projectId'] },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.project.create',
    displayName: '创建项目',
    description: '创建一个项目，输入 name、workDir，可选 description。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.project.create' },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名称' },
        workDir: { type: 'string', description: '项目工作目录' },
        description: { type: 'string', description: '项目描述' },
      },
      required: ['name', 'workDir'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.agent.list',
    displayName: '列出 Agent',
    description: '列出 Agent，可传 projectId；不传时优先使用当前会话项目。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.agent.list' },
    inputSchema: { type: 'object', properties: { projectId: { type: 'string', description: '项目 ID' } } },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.agent.get',
    displayName: '获取 Agent',
    description: '按 agentId 获取 Agent 详情。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.agent.get' },
    inputSchema: { type: 'object', properties: { agentId: { type: 'string', description: 'Agent ID' } }, required: ['agentId'] },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.agent.create',
    displayName: '创建 Agent',
    description: '在项目中创建 Agent。可传 templateId 从模板部署，或传 name/type/runtime 创建自定义 Agent。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.agent.create' },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 ID；不传时使用当前会话项目' },
        templateId: { type: 'string', description: '模板 ID' },
        name: { type: 'string', description: 'Agent 名称' },
        type: { type: 'string', description: 'Agent 类型' },
        runtime: { type: 'string', description: '运行时，如 mock/claude/codex' },
        systemPrompt: { type: 'string', description: '系统提示词' },
        icon: { type: 'string', description: '图标' },
      },
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.session.list',
    displayName: '列出会话',
    description: '列出会话，可按 agentId/projectId 过滤；projectId 不传时优先使用当前会话项目。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.session.list' },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        projectId: { type: 'string', description: '项目 ID' },
      },
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.session.get',
    displayName: '获取会话',
    description: '按 sessionId 获取会话详情。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.session.get' },
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string', description: '会话 ID' } }, required: ['sessionId'] },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.session.create',
    displayName: '创建会话',
    description: '为指定 Agent 创建会话，可选 taskId/projectId。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.session.create' },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        projectId: { type: 'string', description: '项目 ID；不传时使用当前会话项目' },
        taskId: { type: 'string', description: '任务 ID' },
      },
      required: ['agentId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.task.list',
    displayName: '列出任务',
    description: '列出当前项目中的任务。可选输入 status/projectId 过滤任务。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.task.list' },
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '任务状态过滤' },
        projectId: { type: 'string', description: '项目 ID；不传时使用当前会话项目' },
      },
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.task.create',
    displayName: '创建任务',
    description: '在项目中创建一个新任务并可选分派给指定 Agent 执行。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.task.create' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务描述' },
        assignAgentId: { type: 'string', description: '指派的 Agent ID' },
        projectId: { type: 'string', description: '项目 ID；不传时使用当前会话项目' },
      },
      required: ['title'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'create_task',
    displayName: '创建任务',
    description: '兼容旧名：创建一个新任务并可选分派给指定 Agent 执行。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'createTask' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务描述' },
        assignAgentId: { type: 'string', description: '指派的 Agent ID' },
        projectId: { type: 'string', description: '项目 ID；不传时使用当前会话项目' },
      },
      required: ['title'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'create_schedule',
    displayName: '创建定时任务',
    description: '兼容旧名：创建一个 cron 定时规则。',
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
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
]

const BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  ...CORE_BUILTIN_TOOLS,
  ...TEAM_BUILTIN_TOOLS,
]

export function seedBuiltinTools(): void {
  cleanupObsoleteBuiltinTools()

  let created = 0
  let updated = 0
  for (const def of BUILTIN_TOOLS) {
    const existing = toolStore.getByName(def.name)
    if (existing) {
      toolStore.update(existing.id, def)
      toolBindingStore.set(existing.id, def.defaultScope, null)
      updated += 1
      continue
    }

    const tool = toolStore.create(def)
    toolBindingStore.set(tool.id, def.defaultScope, null)
    created += 1
  }

  log.info({ created, updated, obsoleteRemoved: OBSOLETE_BUILTIN_TOOLS.length }, '内置工具已同步')
}

function cleanupObsoleteBuiltinTools(): void {
  const db = getDb()
  const rows = toolStore.list().filter(tool => tool.is_builtin === 1 && OBSOLETE_BUILTIN_TOOLS.includes(tool.name))
  if (rows.length === 0) return

  const names = rows.map(row => row.name)
  const ids = rows.map(row => row.id)
  const placeholders = ids.map(() => '?').join(', ')
  db.prepare(`DELETE FROM tool_bindings WHERE tool_id IN (${placeholders})`).run(...ids)
  db.prepare(`DELETE FROM tools WHERE id IN (${placeholders})`).run(...ids)

  const revokedAt = new Date().toISOString()
  const contexts = db.prepare<[], { id: string; visible_tools_json: string }>('SELECT id, visible_tools_json FROM tool_contexts WHERE revoked_at IS NULL').all()
  const revoke = db.prepare('UPDATE tool_contexts SET revoked_at = ? WHERE id = ?')
  let revoked = 0
  for (const context of contexts) {
    if (!contextIncludesAnyTool(context.visible_tools_json, names)) continue
    revoke.run(revokedAt, context.id)
    revoked += 1
  }

  log.warn({ names, removed: rows.length, revokedContexts: revoked }, '旧的坏内置工具已清理')
}

function contextIncludesAnyTool(value: string, names: string[]): boolean {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.some(item => typeof item === 'string' && names.includes(item))
  } catch {
    return false
  }
}
