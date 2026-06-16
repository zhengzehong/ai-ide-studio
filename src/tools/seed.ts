import { getDb } from '../store/db.js'
import { toolStore, toolBindingStore } from '../store/tools.js'
import { createChildLogger } from '../core/logger.js'
import type { CreateToolInput } from '../store/tools.js'
import { TEAM_BUILTIN_TOOLS } from './team-seed.js'
import { EVENT_CENTER_BUILTIN_TOOLS } from './event-center-seed.js'
import { AGENT_SESSION_BUILTIN_TOOLS } from './agent-session-seed.js'

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
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: '项目 ID' } },
      required: ['projectId'],
    },
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
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'string', description: 'Agent ID' } },
      required: ['agentId'],
    },
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
        modelProfileId: { type: 'string', description: '模型档案 ID，必须与 Agent runtime 匹配' },
      },
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.model_profile.list',
    displayName: '列出模型档案',
    description: '列出 Agent 可用的模型档案，可按 runtime 和启用状态过滤。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.model_profile.list' },
    inputSchema: {
      type: 'object',
      properties: {
        runtime: { type: 'string', enum: ['claude', 'codex'], description: 'Agent runtime' },
        enabledOnly: { type: 'boolean', description: '仅返回已启用档案' },
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
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: '会话 ID' } },
      required: ['sessionId'],
    },
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
        sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'], description: '会话策略：existing=指定已有会话，new_each=新建会话，new_fixed=固定新会话' },
        sessionId: { type: 'string', description: '会话 ID；sessionMode=existing 时必填，new_fixed 时可作为固定会话' },
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
        sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'], description: '会话策略：existing=指定已有会话，new_each=新建会话，new_fixed=固定新会话' },
        sessionId: { type: 'string', description: '会话 ID；sessionMode=existing 时必填，new_fixed 时可作为固定会话' },
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
    displayName: '创建定时任务（旧）',
    description: '兼容旧名：创建一个 cron 定时规则。推荐使用 core.schedule.create。',
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
        sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'], description: '会话策略：existing=指定已有会话，new_each=每次新会话，new_fixed=固定新会话' },
        sessionId: { type: 'string', description: '会话 ID；sessionMode=existing 时必填，new_fixed 时可作为固定会话' },
      },
      required: ['name', 'cron', 'taskTitle'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.schedule.create',
    displayName: '创建定时规则',
    description: '创建一个 cron 定时规则，支持创建任务或发送 Prompt。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.schedule.create' },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '规则名称' },
        cron: { type: 'string', description: '5 字段 cron 表达式' },
        action: { type: 'string', description: '动作类型：create_task 或 send_prompt' },
        taskTitle: { type: 'string', description: '任务标题' },
        taskDescription: { type: 'string', description: '任务描述' },
        assignAgentId: { type: 'string', description: '指派 Agent' },
        sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'], description: '会话策略：existing=指定已有会话，new_each=每次新会话，new_fixed=固定新会话' },
        sessionId: { type: 'string', description: '会话 ID；sessionMode=existing 时必填，new_fixed 时可作为固定会话' },
        prompt: { type: 'string', description: 'send_prompt 时的消息内容' },
        agentId: { type: 'string', description: 'send_prompt 时的目标 Agent' },
        maxRuns: { type: 'number', description: '最大执行次数' },
      },
      required: ['name', 'cron'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.schedule.list',
    displayName: '查看定时规则',
    description: '查看当前项目的定时规则列表。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.schedule.list' },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 ID' },
        enabled: { type: 'boolean', description: '按启用过滤' },
      },
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.schedule.update',
    displayName: '修改定时规则',
    description: '修改一条定时规则。只能修改自己创建的规则。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.schedule.update' },
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: '规则 ID' },
        name: { type: 'string' },
        cron: { type: 'string' },
        enabled: { type: 'boolean' },
        taskTitle: { type: 'string' },
        maxRuns: { type: 'number' },
      },
      required: ['ruleId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.schedule.delete',
    displayName: '删除定时规则',
    description: '删除一条定时规则。只能删除自己创建的规则。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.schedule.delete' },
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: '规则 ID' },
      },
      required: ['ruleId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.schedule.toggle',
    displayName: '启停定时规则',
    description: '启用或禁用一条定时规则。只能操作自己创建的规则。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.schedule.toggle' },
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: '规则 ID' },
        enabled: { type: 'boolean', description: '启用=true，禁用=false' },
      },
      required: ['ruleId', 'enabled'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.schedule.executions',
    displayName: '查看执行历史',
    description: '查看某条定时规则的执行历史记录。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.schedule.executions' },
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: '规则 ID' },
        limit: { type: 'number', description: '返回条数，默认 20' },
      },
      required: ['ruleId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.create',
    displayName: '创建项目任务',
    description: '在 AI IDE Studio 项目中创建一个新任务。这是平台级任务管理，用于追踪需要完成的工作项。指派 Agent 后会自动发送任务指派消息。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.create' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务描述' },
        assignAgentId: { type: 'string', description: '指派 Agent（可选）' },
        sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'], description: '会话策略：existing=指定已有会话，new_each=新建会话，new_fixed=固定新会话' },
        sessionId: { type: 'string', description: '会话 ID；sessionMode=existing 时必填，new_fixed 时可作为固定会话' },
        projectId: { type: 'string', description: '项目 ID（不传用当前会话项目）' },
      },
      required: ['title'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.list',
    displayName: '查看项目任务列表',
    description: '查看当前 AI IDE Studio 项目中的任务列表。可按状态过滤。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.list' },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 ID（不传用当前会话项目）' },
        status: { type: 'string', description: '按状态过滤：backlog/executing/needs_input/blocked/reviewing/completed/cancelled' },
      },
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.get',
    displayName: '查看任务详情',
    description: '获取 AI IDE Studio 项目中单个任务的完整详情。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.get' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
      },
      required: ['taskId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.update_progress',
    displayName: '更新任务进度',
    description: '更新你当前正在执行的 AI IDE Studio 项目任务的进度。每完成一个阶段都应该调用此工具让用户了解进展。当从待确认或阻塞状态恢复时也用此工具。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.update_progress' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        stage: { type: 'string', description: '当前阶段描述' },
      },
      required: ['taskId', 'stage'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.request_input',
    displayName: '请求人工输入',
    description: '当你在执行 AI IDE Studio 项目任务时，遇到需要人工决策或确认的分支，调用此工具。用户会在任务面板中看到你的问题。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.request_input' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        question: { type: 'string', description: '需要人工确认的问题' },
      },
      required: ['taskId', 'question'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.mark_blocked',
    displayName: '标记任务阻塞',
    description: '当你在执行 AI IDE Studio 项目任务时，遇到自己无法解决的问题（如缺少权限、缺少依赖、需要外部操作），调用此工具上报阻塞。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.mark_blocked' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        reason: { type: 'string', description: '阻塞原因' },
      },
      required: ['taskId', 'reason'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.mark_done',
    displayName: '标记任务完成',
    description: '当你认为 AI IDE Studio 项目任务已经完成，调用此工具通知用户进行审查。请在 summary 中说明你完成了什么。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.mark_done' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        summary: { type: 'string', description: '完成总结' },
      },
      required: ['taskId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
]

const BUILTIN_TOOLS: (CreateToolInput & { defaultScope?: 'global' })[] = [
  ...CORE_BUILTIN_TOOLS,
  ...EVENT_CENTER_BUILTIN_TOOLS,
  ...AGENT_SESSION_BUILTIN_TOOLS,
  ...TEAM_BUILTIN_TOOLS,
]

export function seedBuiltinTools(): void {
  cleanupObsoleteBuiltinTools()
  cleanupTeamGlobalBindings()

  let created = 0
  let updated = 0
  for (const def of BUILTIN_TOOLS) {
    const existing = toolStore.getByName(def.name)
    if (existing) {
      toolStore.update(existing.id, def)
      if (def.defaultScope) toolBindingStore.set(existing.id, def.defaultScope, null)
      updated += 1
      continue
    }

    const tool = toolStore.create(def)
    if (def.defaultScope) toolBindingStore.set(tool.id, def.defaultScope, null)
    created += 1
  }

  log.info({ created, updated, obsoleteRemoved: OBSOLETE_BUILTIN_TOOLS.length }, '内置工具已同步')
}

function cleanupTeamGlobalBindings(): void {
  const rows = getDb()
    .prepare<[], { id: string }>(
      `
    SELECT tool_bindings.id
    FROM tool_bindings
    JOIN tools ON tools.id = tool_bindings.tool_id
    WHERE tools.name LIKE 'team.%'
      AND tool_bindings.scope = 'global'
      AND tool_bindings.target_id IS NULL
  `,
    )
    .all()
  if (rows.length === 0) return

  const placeholders = rows.map(() => '?').join(', ')
  getDb()
    .prepare(`DELETE FROM tool_bindings WHERE id IN (${placeholders})`)
    .run(...rows.map((row) => row.id))
  log.warn({ removed: rows.length }, 'Team 工具全局绑定已清理')
}

function cleanupObsoleteBuiltinTools(): void {
  const db = getDb()
  const rows = toolStore.list().filter((tool) => tool.is_builtin === 1 && OBSOLETE_BUILTIN_TOOLS.includes(tool.name))
  if (rows.length === 0) return

  const names = rows.map((row) => row.name)
  const ids = rows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(', ')
  db.prepare(`DELETE FROM tool_bindings WHERE tool_id IN (${placeholders})`).run(...ids)
  db.prepare(`DELETE FROM tools WHERE id IN (${placeholders})`).run(...ids)

  const revokedAt = new Date().toISOString()
  const contexts = db
    .prepare<
      [],
      { id: string; visible_tools_json: string }
    >('SELECT id, visible_tools_json FROM tool_contexts WHERE revoked_at IS NULL')
    .all()
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
    return Array.isArray(parsed) && parsed.some((item) => typeof item === 'string' && names.includes(item))
  } catch {
    return false
  }
}
