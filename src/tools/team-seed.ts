import type { CreateToolInput } from '../store/tools.js'

const TEAM_PERMISSIONS = { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false }

type BuiltinToolSeed = CreateToolInput & { defaultScope?: 'global' }

function teamTool(name: string, displayName: string, description: string, inputSchema: object): BuiltinToolSeed {
  return {
    name,
    displayName,
    description,
    category: 'automation',
    type: 'builtin',
    config: { handler: name },
    inputSchema,
    permissions: TEAM_PERMISSIONS,
    isBuiltin: true,
  }
}

export const TEAM_BUILTIN_TOOLS: BuiltinToolSeed[] = [
  teamTool('team.list', '列出 Team', '列出当前项目的 Team。', {
    type: 'object',
    properties: { projectId: { type: 'string', description: '项目 ID；不传时使用当前会话项目' } },
  }),
  teamTool('team.get', '获取 Team', '获取 Team 详情、成员、任务和最近 mailbox。', {
    type: 'object',
    properties: { teamId: { type: 'string', description: 'Team ID' } },
    required: ['teamId'],
  }),
  teamTool('team.create', '创建 Team', '创建 Team，并把当前 Agent 作为初始主控成员。', {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '项目 ID；不传时使用当前会话项目' },
      name: { type: 'string', description: 'Team 名称' },
      description: { type: 'string', description: 'Team 描述' },
    },
    required: ['name'],
  }),
  teamTool('team.update', '更新 Team', '更新 Team 元信息。', {
    type: 'object',
    properties: {
      teamId: { type: 'string', description: 'Team ID' },
      name: { type: 'string', description: 'Team 名称' },
      description: { type: 'string', description: 'Team 描述' },
      status: { type: 'string', description: 'Team 状态' },
    },
    required: ['teamId'],
  }),
  teamTool('team.member.list', '列出 Team 成员', '列出 Team 成员。', {
    type: 'object',
    properties: { teamId: { type: 'string', description: 'Team ID；不传时使用上下文 Team' } },
  }),
  teamTool('team.member.spawn', '创建 Team 成员', '从模板创建成员，或把已有 Agent 加入 Team。', {
    type: 'object',
    properties: {
      teamId: { type: 'string', description: 'Team ID；不传时使用上下文 Team' },
      templateId: { type: 'string', description: 'Agent 模板 ID' },
      agentId: { type: 'string', description: '已有 Agent ID' },
      name: { type: 'string', description: '成员/Agent 名称' },
      type: { type: 'string', description: '自定义 Agent 类型' },
      runtime: { type: 'string', description: '运行时 mock/claude/codex' },
      systemPrompt: { type: 'string', description: '系统提示词' },
      icon: { type: 'string', description: '图标' },
      role: { type: 'string', description: '成员角色标签' },
    },
  }),
  teamTool('team.member.message', '派活给成员', '给 Team 成员派活，异步触发成员 Session 执行。', {
    type: 'object',
    properties: {
      teamId: { type: 'string', description: 'Team ID；不传时使用上下文 Team' },
      memberId: { type: 'string', description: '目标成员 ID' },
      content: { type: 'string', description: '派活内容' },
      taskId: { type: 'string', description: '关联任务 ID' },
    },
    required: ['memberId', 'content'],
  }),
  teamTool('team.mailbox.list', '列出 Team 留言', '查看团队留言、问题、结果和汇报。', {
    type: 'object',
    properties: {
      teamId: { type: 'string', description: 'Team ID；不传时使用上下文 Team' },
      limit: { type: 'number', description: '返回数量' },
    },
  }),
  teamTool('team.mailbox.send', '发送 Team 留言', '写入团队留言、问题、结果或汇报，不触发 Agent 执行。', {
    type: 'object',
    properties: {
      teamId: { type: 'string', description: 'Team ID；不传时使用上下文 Team' },
      type: { type: 'string', description: '消息类型 message/report/question/result' },
      content: { type: 'string', description: '消息内容' },
      fromMemberId: { type: 'string', description: '发送成员 ID；不传时使用上下文成员' },
      toMemberId: { type: 'string', description: '接收成员 ID' },
      taskId: { type: 'string', description: '关联任务 ID' },
      payload: { type: 'object', description: '结构化附加数据' },
    },
    required: ['content'],
  }),
  teamTool('team.task.list', '列出 Team 任务', '查看 Team 关联任务。', {
    type: 'object',
    properties: {
      teamId: { type: 'string', description: 'Team ID；不传时使用上下文 Team' },
      status: { type: 'string', description: '任务状态过滤' },
    },
  }),
  teamTool('team.task.create', '创建 Team 任务', '创建 Team 任务，可指派成员。', {
    type: 'object',
    properties: {
      teamId: { type: 'string', description: 'Team ID；不传时使用上下文 Team' },
      title: { type: 'string', description: '任务标题' },
      description: { type: 'string', description: '任务描述' },
      assigneeMemberId: { type: 'string', description: '指派成员 ID' },
    },
    required: ['title'],
  }),
  teamTool('team.task.update', '更新 Team 任务', '更新 Team 任务状态、阶段或指派成员。', {
    type: 'object',
    properties: {
      teamId: { type: 'string', description: 'Team ID；不传时使用上下文 Team' },
      taskId: { type: 'string', description: '任务 ID' },
      status: { type: 'string', description: '任务状态' },
      stage: { type: 'string', description: '任务阶段' },
      assigneeMemberId: { type: 'string', description: '指派成员 ID' },
    },
    required: ['taskId'],
  }),
  teamTool('team.template.list', '列出 Agent 模板', '列出可用于 Team spawn 的 Agent 模板。', {
    type: 'object',
    properties: {},
  }),
  teamTool('team.template.describe', '查看 Agent 模板', '查看 Agent 模板能力说明。', {
    type: 'object',
    properties: { templateId: { type: 'string', description: '模板 ID' } },
    required: ['templateId'],
  }),
]
