import { getDb } from '../store/db.js'
import { toolStore, toolBindingStore } from '../store/tools.js'
import { createChildLogger } from '../core/logger.js'
import type { CreateToolInput } from '../store/tools.js'
import { TEAM_BUILTIN_TOOLS } from './team-seed.js'
import { EVENT_CENTER_BUILTIN_TOOLS } from './event-center-seed.js'
import { AGENT_SESSION_BUILTIN_TOOLS } from './agent-session-seed.js'
import { KB_BUILTIN_TOOLS } from './kb-seed.js'
import { AGENT_MEMORY_BUILTIN_TOOLS } from './agent-memory-seed.js'
import { AGENT_HUB_BUILTIN_TOOLS } from './agent-hub-seed.js'

const log = createChildLogger('tool-seed')

const CORE_PERMISSIONS = { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false }
const OBSOLETE_BUILTIN_TOOLS = [
  'search_files',
  'get_project_info',
  'list_agents',
  'http_fetch',
  'agent.watch.create',
  'agent.watch.cancel',
]

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
    name: 'agent.template.list',
    displayName: '列出 Agent 模板',
    description: '列出 Agent 广场中的全局模板。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'agent.template.list' },
    inputSchema: { type: 'object', properties: {} },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent.template.get',
    displayName: '获取 Agent 模板',
    description: '按 templateId 获取 Agent 广场模板详情。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'agent.template.get' },
    inputSchema: {
      type: 'object',
      properties: { templateId: { type: 'string', description: '模板 ID' } },
      required: ['templateId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent.template.create',
    displayName: '创建 Agent 模板',
    description: '创建 Agent 广场模板。只创建全局模板，不会自动添加到项目或配置事件订阅。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent.template.create' },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '模板名称' },
        type: { type: 'string', description: 'Agent 类型' },
        runtime: { type: 'string', enum: ['mock', 'claude', 'codex'], description: '运行时' },
        icon: { type: 'string', description: '图标' },
        description: { type: 'string', description: '模板描述' },
        systemPrompt: { type: 'string', description: '系统提示词' },
        skills: { type: 'array', items: { type: 'string' }, description: '能力标签' },
      },
      required: ['name', 'type'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent.template.update',
    displayName: '更新 Agent 模板',
    description: '更新 Agent 广场模板。字段不传则保持原值。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent.template.update' },
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: '模板 ID' },
        name: { type: 'string', description: '模板名称' },
        type: { type: 'string', description: 'Agent 类型' },
        runtime: { type: 'string', enum: ['mock', 'claude', 'codex'], description: '运行时' },
        icon: { type: 'string', description: '图标' },
        description: { type: 'string', description: '模板描述' },
        systemPrompt: { type: 'string', description: '系统提示词' },
        skills: { type: 'array', items: { type: 'string' }, description: '能力标签' },
      },
      required: ['templateId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent.template.delete',
    displayName: '删除 Agent 模板',
    description: '删除 Agent 广场自定义模板。内置模板不能删除。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent.template.delete' },
    inputSchema: {
      type: 'object',
      properties: { templateId: { type: 'string', description: '模板 ID' } },
      required: ['templateId'],
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
    name: 'core.timeline.list',
    displayName: 'List timeline',
    description: 'List timeline summaries for a session.',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.timeline.list' },
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        status: { type: 'string', enum: ['raw', 'refined'], description: 'Timeline summary status' },
        limit: { type: 'number', description: 'Maximum number of summaries' },
      },
      required: ['sessionId'],
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
        sessionMode: {
          type: 'string',
          enum: ['existing', 'new_each', 'new_fixed'],
          description: '会话策略：existing=指定已有会话，new_each=新建会话，new_fixed=固定新会话',
        },
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
        sessionMode: {
          type: 'string',
          enum: ['existing', 'new_each', 'new_fixed'],
          description: '会话策略：existing=指定已有会话，new_each=新建会话，new_fixed=固定新会话',
        },
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
        sessionMode: {
          type: 'string',
          enum: ['existing', 'new_each', 'new_fixed'],
          description: '会话策略：existing=指定已有会话，new_each=每次新会话，new_fixed=固定新会话',
        },
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
        sessionMode: {
          type: 'string',
          enum: ['existing', 'new_each', 'new_fixed'],
          description: '会话策略：existing=指定已有会话，new_each=每次新会话，new_fixed=固定新会话',
        },
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
    description: `创建协作任务容器。两种模式:
- selfExecute=true(对话任务化):用户在当前对话布置任务时用。建一个默认 step(assignee=自己),跳过 prompt 注入,任务直接 running。用户消息本身就是任务上下文。
- selfExecute=false(默认):建空壳任务,无 step 无 assignee。后续用 task.step.add 编排步骤 + task.start 启动。用于多 Agent 协作编排。
简单任务派给别人用 studio.task.createSimple,不要用这个。`,
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.create' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务目标文档(背景/需求/验收标准)' },
        selfExecute: {
          type: 'boolean',
          description: '对话任务化:true=建默认 step 并由当前 Agent 直接执行;false=只建协作空壳。默认 false。',
        },
        projectId: { type: 'string', description: '项目 ID(不传用当前会话项目)' },
      },
      required: ['title', 'description'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.assign',
    displayName: 'Assign project task',
    description:
      'Assign an unassigned AI IDE Studio project task to a target Agent. Reassignment requires allowReassign=true.',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.assign' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        agentId: { type: 'string', description: 'Target Agent ID' },
        sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'], description: 'Session strategy' },
        sessionId: { type: 'string', description: 'Existing session ID to reuse' },
        reason: { type: 'string', description: 'Assignment reason' },
        allowReassign: { type: 'boolean', description: 'Allow assigning a task that already has another Agent' },
      },
      required: ['taskId', 'agentId'],
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
        status: { type: 'string', description: '按状态过滤：draft/running/needs_input/completed/cancelled' },
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
    description:
      '轻量汇报当前阶段（一句话），更新看板卡片显示。每完成一个小步骤都调用。任务处于待确认状态时调用会自动恢复为行动中。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.update_progress' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        stage: { type: 'string', description: '当前阶段描述（一句话）' },
      },
      required: ['taskId', 'stage'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.report',
    displayName: '汇报任务状态',
    description:
      '关键节点汇报：带 Markdown 报告向用户同步进展，并更新自我评估状态。agentStatus=milestone 保持/恢复行动中（Agent 继续工作）；blocked 和 done 让任务进入待确认等待人工处理。可传 stepId 汇报协作任务的步骤状态。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.report' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        agentStatus: {
          type: 'string',
          enum: ['milestone', 'blocked', 'done'],
          description:
            '自我评估状态：milestone=中间步骤完成（阶段性成果，任务保持行动中，继续执行）；blocked=遇到问题需要人工决策；done=本轮完成等待验收',
        },
        reportMd: {
          type: 'string',
          description: 'Markdown 报告，按当前执行模式要求填写，参考任务指派 prompt 中的模板',
        },
        stage: { type: 'string', description: '当前阶段描述（可选）' },
        stepId: { type: 'string', description: '可选,协作任务的步骤 ID。不传走老逻辑(老任务)' },
        artifacts: {
          type: 'array',
          description: '可选,产出列表',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['commit', 'file', 'doc', 'url'] },
              value: { type: 'string' },
            },
          },
        },
      },
      required: ['taskId', 'agentStatus'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.createSimple',
    displayName: '创建简单任务',
    description: `创建简单任务(单 Agent 一步完成),自动建默认 step + 自动 start,立即派发。单 Agent 一步完成的任务用这个,create 即派发,不用手动 start。`,
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.createSimple' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务目标文档' },
        assignee: { type: 'string', description: '分派给哪个 Agent' },
        sessionId: { type: 'string', description: '可选,指定会话(不传系统按 assignee 找 primary 会话)' },
        projectId: { type: 'string' },
      },
      required: ['title', 'description', 'assignee'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.update',
    displayName: '修改任务',
    description: '修改任务标题或目标文档。不会触发回 draft(只改任务级字段,不动 steps)。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.update' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务目标文档' },
      },
      required: ['taskId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.start',
    displayName: '启动任务',
    description:
      '启动任务,系统开始派发 ready 的 step。draft → running,开始派发;running → running,幂等,重新评估全图;completed → 报错。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.start' },
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
    name: 'studio.task.step.get',
    displayName: '查看步骤详情',
    description: '取单个步骤的完整详情 + 历史汇报。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.step.get' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        stepId: { type: 'string', description: '步骤 ID' },
      },
      required: ['taskId', 'stepId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.step.add',
    displayName: '添加步骤',
    description:
      '给任务添加步骤。⚠️ 调用此工具会使任务回退到 draft 状态,系统暂停派发。完成所有步骤编辑后,必须调用 task.start 重新启动任务。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.step.add' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        title: { type: 'string', description: '步骤标题' },
        description: { type: 'string', description: '做什么' },
        assignee: { type: 'string', description: '可选,分派给哪个 Agent(不传 = 待认领)' },
        sessionId: { type: 'string', description: '可选,指定会话' },
        dependsOn: { type: 'array', items: { type: 'string' }, description: '可选,前置 stepId 数组' },
      },
      required: ['taskId', 'title'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.step.update',
    displayName: '修改步骤',
    description:
      '修改步骤(标题/描述/依赖/分派)。⚠️ 调用此工具会使任务回退到 draft 状态,系统暂停派发。dependsOn 整体替换,不是追加。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.step.update' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        stepId: { type: 'string', description: '步骤 ID' },
        title: { type: 'string' },
        description: { type: 'string' },
        dependsOn: { type: 'array', items: { type: 'string' }, description: '传新数组,整体替换' },
        assignee: { type: 'string' },
        sessionId: { type: 'string' },
      },
      required: ['taskId', 'stepId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.step.remove',
    displayName: '删除步骤',
    description:
      '删除步骤。⚠️ 调用此工具会使任务回退到 draft 状态,系统暂停派发。删除时系统自动清理下游依赖。删 running 步骤向对应会话发"步骤已取消"通知。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.step.remove' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        stepId: { type: 'string', description: '步骤 ID' },
      },
      required: ['taskId', 'stepId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.step.updateProgress',
    displayName: '更新步骤进度',
    description:
      '更新步骤进度(一句话,展示用)。轻量进度更新,不带产出,不标记节点,纯展示。不改变 step 状态(step 还是 running)。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.step.updateProgress' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        stepId: { type: 'string', description: '步骤 ID' },
        stage: { type: 'string', description: '一句话描述当前阶段' },
      },
      required: ['taskId', 'stepId', 'stage'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.task.step.report',
    displayName: '汇报步骤状态',
    description:
      '步骤汇报(关键节点/卡住/完成)。milestone:过程标记,继续做;blocked:卡住,等人工决策;done:完成,解锁下游。没有 rejected。任务在 draft 状态时 report 不解锁下游。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.step.report' },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        stepId: { type: 'string', description: '步骤 ID' },
        agentStatus: { type: 'string', enum: ['milestone', 'blocked', 'done'] },
        reportMd: { type: 'string', description: '报告内容(Markdown)' },
        artifacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['commit', 'file', 'doc', 'url'] },
              value: { type: 'string' },
            },
          },
        },
      },
      required: ['taskId', 'stepId', 'agentStatus', 'reportMd'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'preview.publish',
    displayName: '发布原型预览',
    description:
      '发布原型预览。把指定目录或 HTML 文件发布为可访问的预览 URL。调用后前端对话流会自动渲染预览卡片,用户点击全屏查看。返回 {previewId, url, title, target, taskId, createdAt}。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'preview.publish' },
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: '原型根目录或 HTML 文件的绝对路径' },
        title: { type: 'string', description: '预览标题,默认取目录名/文件名' },
        target: { type: 'string', enum: ['pc', 'app'], description: '目标端:pc(宽屏)或 app(手机),默认 pc' },
        entryFile: { type: 'string', description: 'sourcePath 为目录时的入口文件,默认 index.html' },
        taskId: { type: 'string', description: '关联任务 ID(选填)' },
        description: { type: 'string', description: '预览描述(选填)' },
      },
      required: ['sourcePath'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
]

const BUILTIN_TOOLS: (CreateToolInput & { defaultScope?: 'global' })[] = [
  ...CORE_BUILTIN_TOOLS,
  ...KB_BUILTIN_TOOLS,
  ...EVENT_CENTER_BUILTIN_TOOLS,
  ...AGENT_SESSION_BUILTIN_TOOLS,
  ...TEAM_BUILTIN_TOOLS,
  ...AGENT_MEMORY_BUILTIN_TOOLS,
  ...AGENT_HUB_BUILTIN_TOOLS,
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
