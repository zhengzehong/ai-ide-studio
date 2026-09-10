import { getDb } from '../store/db.js'
import { toolStore, toolBindingStore } from '../store/tools.js'
import { createChildLogger } from '../core/logger.js'
import type { CreateToolInput } from '../store/tools.js'
import { TEAM_BUILTIN_TOOLS } from './team-seed.js'
import { EVENT_CENTER_BUILTIN_TOOLS } from './event-center-seed.js'
import { AGENT_SESSION_BUILTIN_TOOLS } from './agent-session-seed.js'
import { ADVISOR_BUILTIN_TOOLS } from './advisor-seed.js'
import { KB_BUILTIN_TOOLS } from './kb-seed.js'
import { AGENT_MEMORY_BUILTIN_TOOLS } from './agent-memory-seed.js'
import { AGENT_HUB_BUILTIN_TOOLS } from './agent-hub-seed.js'
import { DEVICE_BUILTIN_TOOLS } from './device-seed.js'

const log = createChildLogger('tool-seed')

const CORE_PERMISSIONS = { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false }
const SECRETARY_MANAGEMENT_PROPERTIES = {
  name: { type: 'string', description: '秘书名称' },
  definitionPrompt: { type: 'string', description: '秘书职责和观察重点' },
  reportPrompt: { type: 'string', description: '汇报内容与格式要求' },
  executionAgentId: { type: 'string', description: '当前项目内负责执行的 Agent ID' },
  observeAll: { type: 'boolean', description: '是否观察当前项目全部 Agent' },
  observedAgentIds: { type: 'array', items: { type: 'string' }, description: '需要观察的 Agent ID' },
  cron: { type: 'string', description: '可选的 5 段 Cron；空字符串表示清除定时触发' },
  watchSessionDone: { type: 'boolean', description: '是否在观察会话完成时触发' },
  watchTaskNeedsInput: { type: 'boolean', description: '是否在任务需要处理时触发' },
}
const OBSOLETE_BUILTIN_TOOLS = [
  'search_files',
  'get_project_info',
  'list_agents',
  'http_fetch',
  'agent.watch.create',
  'agent.watch.cancel',
  'create_schedule',
  'core.kb.read_index',
  'core.kb.read_page',
  'core.kb.search',
  'core.kb.create_page',
  'core.kb.update_page',
  'core.kb.refresh_from_code',
  'core.kb.create_kb',
  'core.kb.mount',
  'core.kb.unmount',
  'core.kb.revert',
]

const CORE_BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  ...DEVICE_BUILTIN_TOOLS,
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
    name: 'core.session.capabilities',
    displayName: '获取 Session Runtime 能力',
    description: '创建或恢复真实 ACP Session，返回实际可用的模型、模式和配置项；不会发送 Prompt。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.session.capabilities' },
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'Session ID' } },
      required: ['sessionId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.session.configure',
    displayName: '配置 Session Runtime',
    description: '在空闲的新 Session 上配置 ACP 模型、模式或配置项，返回实际生效状态。调用前先使用 core.session.capabilities。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.session.configure' },
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        modelId: { type: 'string', description: 'capabilities 返回的准确 modelId' },
        modeId: { type: 'string', description: 'capabilities 返回的准确 modeId' },
        config: {
          type: 'object',
          description: 'config option ID 到 string/boolean 值的映射',
          additionalProperties: { type: ['string', 'boolean'] },
        },
      },
      required: ['sessionId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.autonomy.plan.update',
    displayName: '更新自主排班',
    description: '更新当前自主 Agent 的当天排班，只使用 current、next、done 三种状态。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.autonomy.plan.update' },
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '排班日期，格式 YYYY-MM-DD' },
        items: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'string', enum: ['current', 'next', 'done'] },
              note: { type: 'string' },
            },
            required: ['id', 'title', 'status'],
          },
        },
        nextCheckAt: { type: 'string', description: '可选的下次检查 ISO 时间' },
      },
      required: ['date', 'items'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.autonomy.report',
    displayName: '提交自主汇报',
    description: '提交一条 GFM Markdown 自主工作汇报，优先级只作为标签。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.autonomy.report' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 160 },
        summary: { type: 'string', maxLength: 500 },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
        markdown: { type: 'string', description: 'GFM Markdown 正文' },
        attachments: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '项目内相对文件路径' },
              title: { type: 'string', maxLength: 160 },
            },
            required: ['path'],
          },
        },
      },
      required: ['title', 'summary', 'priority', 'markdown'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.session.template.list',
    displayName: '列出会话模板',
    description: '列出会话模板(可按 agentId 过滤)。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'core.session.template.list' },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: '按 Agent 过滤,不传则返回全部' },
      },
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'secretary.report',
    displayName: '提交秘书汇报',
    description: '向当前项目秘书邮箱提交或更新一封主题邮件，可附带项目内文件。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'secretary.report' },
    inputSchema: {
      type: 'object',
      properties: {
        threadKey: { type: 'string', description: '同一主题后续更新时复用的键' },
        subject: { type: 'string', description: '邮件主题' },
        summary: { type: 'string', description: '邮件摘要' },
        kind: { type: 'string', enum: ['decision', 'result', 'progress', 'alert', 'digest'] },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] },
        needsAction: { type: 'boolean', description: '是否需要用户处理' },
        markdown: { type: 'string', description: 'Markdown 正文' },
        sourceRefs: { type: 'array', items: { type: 'string' } },
        attachments: { type: 'array', items: { type: 'object' } },
      },
      required: ['subject', 'markdown'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.secretary.list',
    displayName: '列出项目秘书',
    description: '列出当前项目的全部秘书及其配置、触发器和提醒状态。项目由当前会话自动确定。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.secretary.list' },
    inputSchema: { type: 'object', properties: {} },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.secretary.get',
    displayName: '读取项目秘书',
    description: '读取当前项目中一个秘书的完整配置。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.secretary.get' },
    inputSchema: {
      type: 'object',
      properties: { secretaryId: { type: 'string', description: '秘书 ID' } },
      required: ['secretaryId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.secretary.create',
    displayName: '创建项目秘书',
    description: '在当前项目创建秘书。先用 core.agent.list 确认执行 Agent ID。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.secretary.create' },
    inputSchema: {
      type: 'object',
      properties: SECRETARY_MANAGEMENT_PROPERTIES,
      required: ['name', 'executionAgentId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.secretary.update',
    displayName: '修改项目秘书',
    description: '修改当前项目中的秘书配置，只传需要改变的字段。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.secretary.update' },
    inputSchema: {
      type: 'object',
      properties: {
        secretaryId: { type: 'string', description: '秘书 ID' },
        ...SECRETARY_MANAGEMENT_PROPERTIES,
        enabled: { type: 'boolean', description: '是否启用秘书' },
      },
      required: ['secretaryId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'studio.secretary.delete',
    displayName: '删除项目秘书',
    description: '删除当前项目秘书及其隐藏会话和定时规则。必须同时提供当前秘书名称确认。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.secretary.delete' },
    inputSchema: {
      type: 'object',
      properties: {
        secretaryId: { type: 'string', description: '秘书 ID' },
        name: { type: 'string', description: '当前秘书名称，用于确认删除目标' },
      },
      required: ['secretaryId', 'name'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.session.template.publish',
    displayName: '发布会话为模板',
    description:
      '把当前会话发布为会话模板。模板是完整对话镜像(ACP fork),不是 system prompt,新建时整个上下文都会被复制。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.session.template.publish' },
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '源会话 ID' },
        name: { type: 'string', description: '模板名称' },
        description: { type: 'string', description: '模板描述(可选)' },
        icon: { type: 'string', description: '模板图标(可选)' },
      },
      required: ['sessionId', 'name'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.session.template.instantiate',
    displayName: '从模板新建会话',
    description:
      '从模板新建会话。新会话继承模板的完整对话上下文(ACP fork),不是只复制 system prompt。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.session.template.instantiate' },
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: '会话模板 ID' },
      },
      required: ['templateId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'core.session.template.delete',
    displayName: '删除会话模板',
    description: '删除会话模板。模板不存在时静默成功。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'core.session.template.delete' },
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: '会话模板 ID' },
      },
      required: ['templateId'],
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
    name: 'studio.schedule.create',
    displayName: '创建定时规则',
    description: '为当前 Agent 的当前会话创建定时 Prompt。不会创建任务或新会话。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.schedule.create' },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '定时规则名称' },
        cron: { type: 'string', description: '5 段 Cron 表达式，按本地时间执行' },
        prompt: { type: 'string', description: '到时间后注入当前会话的 Prompt' },
      },
      required: ['name', 'cron', 'prompt'],
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
    description: '创建协作任务空壳。仅建空壳,后续 step.add 编排 + task.start 启动。用于多 Agent 协作编排。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.create' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务目标文档(背景/需求/验收标准)' },
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
    description: '分页查看当前项目任务。默认返回 200 条精简摘要；同一问题通常只调用一次，优先用 query 查标题或任务 ID，仅在目标未找到且 hasMore=true 时传 nextCursor 继续。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.list' },
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '按状态过滤：draft/running/needs_input/completed/cancelled' },
        query: { type: 'string', description: '按任务标题或任务 ID 关键词查找' },
        limit: { type: 'number', default: 200, maximum: 200, description: '返回条数，默认和最大均为 200' },
        cursor: { type: 'string', description: '上一页返回的 nextCursor；没有时不要传' },
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
    description:
      '创建一步任务。两种模式:selfExecute=true(对话任务化,自做) / selfExecute=false(派发给别人)。自动建默认 step + 自动 start。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'studio.task.createSimple' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string', description: '任务目标文档' },
        selfExecute: { type: 'boolean', default: false, description: 'true=对话任务化(自做);false=派发给别人' },
        assignee: { type: 'string', description: 'selfExecute=false 时必填;selfExecute=true 时忽略' },
        sessionId: { type: 'string', description: 'selfExecute=false 时可指定会话;selfExecute=true 时忽略' },
      },
      required: ['title', 'description'],
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
    name: 'inspiration.analysis.publish',
    displayName: '发布灵感整理结果',
    description: '暂存当前项目灵感的结构化整理结果。同一分析轮次可重复调用并以最后一次为准；禁止使用测试或占位内容。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'inspiration.analysis.publish' },
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
        summary: { type: 'string', minLength: 8 },
        bodyMarkdown: { type: 'string', minLength: 80 },
        questions: { type: 'array', maxItems: 20, items: { type: 'string', description: '直接传字符串，不要传对象' } },
        candidates: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              descriptionMarkdown: { type: 'string' },
              suggestedAgentId: { type: 'string' },
              agentReason: { type: 'string' },
            },
            required: ['title', 'descriptionMarkdown'],
          },
        },
      },
      required: ['noteId', 'expectedRevision', 'summary', 'bodyMarkdown', 'questions', 'candidates'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'inspiration.note.get',
    displayName: '读取项目灵感',
    description: '读取当前项目的一条灵感原文、最新整理结果和候选任务，仅灵感会话可用。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'inspiration.note.get' },
    inputSchema: {
      type: 'object',
      properties: { noteId: { type: 'string', description: '灵感 ID' } },
      required: ['noteId'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'files.present',
    displayName: '展示交付文件',
    description: '向用户展示一个或多个项目交付文件，支持在 PC 和 APP 会话中点击查看。',
    category: 'filesystem',
    type: 'builtin',
    config: { handler: 'files.present' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '交付内容标题，默认“本次交付”' },
        files: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '项目工作目录内的相对文件路径' },
              title: { type: 'string', description: '文件展示标题，默认使用文件名' },
            },
            required: ['path'],
          },
        },
      },
      required: ['files'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'reading.add',
    displayName: '加入阅读列表',
    description:
      '把当前会话生成的长文加入用户的阅读列表。只传标题、类型和内容；项目、会话和 Agent 由系统注入。MD/HTML 传 Gateway 本机绝对文件路径，URL 只允许 HTTP 或 HTTPS。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'reading.add' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '阅读条目标题' },
        type: { type: 'string', enum: ['md', 'html', 'url'], description: '内容类型' },
        content: { type: 'string', description: 'MD/HTML 的绝对文件路径，或 HTTP/HTTPS URL' },
      },
      required: ['title', 'type', 'content'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'preview.publish',
    displayName: '发布原型预览',
    description:
      '发布 HTML 预览。为用户生成 HTML 或原型后,必须调用此工具发布给用户,用户可在对话流中直接打开查看。',
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
  {
    name: 'spreadsheet_create_table',
    displayName: '新建项目表格',
    description:
      '在当前项目内新建一张空表。不传 fields 时使用默认字段（标题 text / 状态 singleSelect：待处理、进行中、已完成 / 日期 date）；可用 fields 自定义字段（类型 text/number/singleSelect/date/checkbox，singleSelect 选项自动配色）。name 在项目内唯一，建表后用 spreadsheet_write_rows 写数据。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'spreadsheet_create_table' },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '表格 AI 短名（项目内唯一，后续 query/write/manage_schema 均用它引用）' },
        title: { type: 'string', description: '可选：显示名，缺省同 name' },
        fields: {
          type: 'array',
          description:
            '可选：字段定义列表，每个元素为 {name, type, key?, options?}——name 字段显示名；type 为 text/number/singleSelect/date/checkbox 之一；key 可选（缺省由英文显示名生成或自动分配）；options 为 singleSelect 的选项名列表（自动配色）。缺省整个 fields 时使用默认字段（标题/状态/日期）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '字段显示名' },
              type: { type: 'string', enum: ['text', 'number', 'singleSelect', 'date', 'checkbox'], description: '字段类型' },
              key: { type: 'string', description: '可选：字段 key（缺省由显示名生成或自动分配）' },
              options: { type: 'array', items: { type: 'string' }, description: 'singleSelect 选项名列表（自动配色）' },
            },
            required: ['name', 'type'],
          },
        },
      },
      required: ['name'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'spreadsheet_list_tables',
    displayName: '列出项目表格',
    description: '列出当前项目内的所有表格，并附带每张表的字段定义（key、名称、类型、单选选项）与记录数。写数据前必须先调用本工具拿到表名与字段结构。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'spreadsheet_list_tables' },
    inputSchema: { type: 'object', properties: {} },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'spreadsheet_query_rows',
    displayName: '查询表格记录',
    description: '读取指定表格的记录。支持 filter（多条件 AND 组合）、fields（字段投影）、limit（默认 50，最大 200）与 offset 分页。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'spreadsheet_query_rows' },
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表格短名（来自 spreadsheet_list_tables 的 name）' },
        filter: { type: 'object', description: '可选：{字段key: 值}，多条件 AND 组合；文本按包含匹配，其余按相等匹配', additionalProperties: true },
        fields: { type: 'array', items: { type: 'string' }, description: '可选：只返回这些字段 key（投影）' },
        limit: { type: 'number', description: '可选：返回条数，默认 50，最大 200' },
        offset: { type: 'number', description: '可选：跳过条数，默认 0' },
      },
      required: ['table'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'spreadsheet_write_rows',
    displayName: '写入表格记录',
    description:
      '向指定表格写入记录。mode=append 追加新行；mode=update 按 recordId 修改已有行（只传要改的字段）。数据按 schema 校验，报错列出合法取值，按报错自纠后重试。无删除能力。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'spreadsheet_write_rows' },
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表格短名（来自 spreadsheet_list_tables 的 name）' },
        mode: { type: 'string', enum: ['append', 'update'], description: 'append=追加新行；update=按 recordId 修改已有行' },
        rows: {
          type: 'array',
          maxItems: 200,
          items: { type: 'object', additionalProperties: true },
          description: '要写入的行数据数组；update 模式下每行需带 recordId',
        },
      },
      required: ['table', 'mode', 'rows'],
    },
    permissions: CORE_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'spreadsheet_manage_schema',
    displayName: '管理表格结构',
    description:
      '管理表格结构（字段与单选选项），按 action 分发：addField/renameField/changeFieldType/removeField/addOption/renameOption/removeOption。removeField、removeOption、changeFieldType 为破坏性操作：未带 confirm:true 且影响记录数大于 0 时不执行，报错返回影响面，确认后带 confirm:true 重试。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'spreadsheet_manage_schema' },
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表格短名（来自 spreadsheet_list_tables 的 name）' },
        action: {
          type: 'string',
          enum: ['addField', 'renameField', 'changeFieldType', 'removeField', 'addOption', 'renameOption', 'removeOption'],
          description: '要执行的结构操作',
        },
        field: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '字段显示名' },
            type: { type: 'string', enum: ['text', 'number', 'singleSelect', 'date', 'checkbox'], description: '字段类型' },
            options: { type: 'array', items: { type: 'string' }, description: 'singleSelect 初始选项名列表（自动配色）' },
          },
          required: ['name', 'type'],
          description: 'addField 必填：新字段定义',
        },
        fieldKey: { type: 'string', description: '字段 key' },
        name: { type: 'string', description: 'renameField：新的显示名' },
        type: { type: 'string', enum: ['text', 'number', 'singleSelect', 'date', 'checkbox'], description: 'changeFieldType：目标类型' },
        options: { type: 'array', items: { type: 'string' }, description: 'changeFieldType 目标为 singleSelect 时：新的选项名列表' },
        option: {
          type: 'object',
          properties: { name: { type: 'string', description: '选项名' } },
          required: ['name'],
          description: 'addOption 必填：要添加的选项',
        },
        from: { type: 'string', description: 'renameOption：原选项名' },
        to: { type: 'string', description: 'renameOption：新选项名' },
        confirm: { type: 'boolean', description: '破坏性操作二次确认；首次不传，看到影响面后确认再传 true' },
      },
      required: ['table', 'action'],
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
  ...ADVISOR_BUILTIN_TOOLS,
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
      AND tools.name NOT IN ('team.list', 'team.conversation.list')
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
