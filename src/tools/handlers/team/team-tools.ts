import { teamService } from '../../../core/teams.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'
import { assertTeamMemberAccess } from '../../../core/team-access.js'
import { describeLineScope, type AgentLineScope } from '../../../core/team-line-scope.js'

export const listTeamsHandler: ToolHandler = {
  name: 'team.list',
  description: '列出当前项目的 Team',
  inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
  async execute(input, context) {
    return jsonResult({ teams: teamService.list(resolveProjectId(input, context)).map(team => ({
      teamId: team.id, name: team.name, description: team.description,
    })) })
  },
}

export const getTeamHandler: ToolHandler = {
  name: 'team.get',
  description: '获取 Team 详情、本线成员、本线任务和本线最近 mailbox（按会话线硬隔离，只看当前会话线）',
  inputSchema: { type: 'object', properties: { teamId: { type: 'string' } }, required: ['teamId'] },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    const scope = lineScopeFor(teamId, context)
    return jsonResult(teamService.detailForLine(teamId, scope))
  },
}

export const createTeamHandler: ToolHandler = {
  name: 'team.create',
  description: '创建 Team，自动创建隐藏的 Master 并绑定团队工具；masterPrompt 可调整内置默认提示词',
  inputSchema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, masterPrompt: { type: 'string' } },
    required: ['name'],
  },
  async execute(input, context) {
    const projectId = resolveProjectId(input, context)
    if (!projectId) throw new Error('projectId 不能为空')
    const { team } = teamService.create({
        projectId,
        name: requireString(input, 'name'),
        description: optionalString(input, 'description'),
        masterPrompt: optionalString(input, 'masterPrompt'),
      })
    // agent 建团队时同步开首线：agent 没有"新建会话线"工具（那是人在团队面板里的动作），
    // 而 v3 硬隔离下无线团队的 mailbox 写入会被拒收（成员汇报必丢），故在建团队时补齐这条线。
    teamService.ensureDefaultConversation(team.id)
    return jsonResult({ team: { teamId: team.id, name: team.name, description: team.description } })
  },
}

export const updateTeamHandler: ToolHandler = {
  name: 'team.update',
  description: '更新 Team 元信息',
  inputSchema: {
    type: 'object',
    properties: {
      teamId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      masterPrompt: { type: 'string' },
      status: { type: 'string' },
    },
    required: ['teamId'],
  },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    const team = teamService.update(teamId, {
      name: optionalString(input, 'name'),
      description: optionalNullableString(input, 'description'),
      masterPrompt: optionalString(input, 'masterPrompt'),
      status: optionalString(input, 'status'),
    })
    return jsonResult({ team })
  },
}

export const listTeamMembersHandler: ToolHandler = {
  name: 'team.member.list',
  description: '列出 Team 成员',
  inputSchema: { type: 'object', properties: { teamId: { type: 'string' } } },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    return jsonResult({ members: teamService.listMembers(teamId) })
  },
}

export const spawnTeamMemberHandler: ToolHandler = {
  name: 'team.member.spawn',
  description: '从模板或已有 Agent 定义创建团队专属成员，不复制历史会话和记忆。默认继承 Master 模型档案；指定档案前先调用 core.model_profile.list 查询，再传 modelProfileId。',
  inputSchema: {
    type: 'object',
    properties: {
      teamId: { type: 'string' },
      templateId: { type: 'string' },
      agentId: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      runtime: { type: 'string' },
      systemPrompt: { type: 'string' },
      icon: { type: 'string' },
      role: { type: 'string' },
      modelProfileId: { type: 'string', description: '可选成员模型档案 ID；不传则继承 Master，先使用 core.model_profile.list 查询' },
    },
  },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    return jsonResult(
      teamService.spawnMember({
        teamId,
        templateId: optionalString(input, 'templateId'),
        agentId: optionalString(input, 'agentId'),
        name: optionalString(input, 'name'),
        type: optionalString(input, 'type'),
        runtime: optionalString(input, 'runtime'),
        systemPrompt: optionalString(input, 'systemPrompt'),
        icon: optionalString(input, 'icon'),
        role: optionalString(input, 'role'),
        modelProfileId: optionalString(input, 'modelProfileId'),
      }),
    )
  },
}

export const messageTeamMemberHandler: ToolHandler = {
  name: 'team.member.message',
  description: '给 Team 成员派活，异步触发成员 Session 执行',
  inputSchema: {
    type: 'object',
    properties: {
      teamId: { type: 'string' },
      memberId: { type: 'string' },
      content: { type: 'string' },
      taskId: { type: 'string' },
    },
    required: ['memberId', 'content'],
  },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    return jsonResult(
      teamService.dispatchMessage({
        teamId,
        memberId: requireString(input, 'memberId'),
        content: requireString(input, 'content'),
        taskId: optionalString(input, 'taskId'),
        sourceSessionId: context.sessionId,
      }),
    )
  },
}

export const listTeamMailboxHandler: ToolHandler = {
  name: 'team.mailbox.list',
  description: '查看本会话线的团队留言、问题、结果和汇报（按会话线硬隔离，不含他线，无全局开关）',
  inputSchema: { type: 'object', properties: { teamId: { type: 'string' }, limit: { type: 'number' } } },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    const scope = lineScopeFor(teamId, context)
    return jsonResult({
      messages: teamService.listMailboxForLine(teamId, scope, optionalNumber(input, 'limit')),
      lineScope: describeLineScope(scope),
    })
  },
}

export const sendTeamMailboxHandler: ToolHandler = {
  name: 'team.mailbox.send',
  description: '写入本会话线的团队留言、问题、结果或汇报，不触发 Agent 执行；type=report/result 必须带 taskId；成员汇报请把 toMemberId 填 Leader/留空（不要填自己）',
  inputSchema: {
    type: 'object',
    properties: {
      teamId: { type: 'string' },
      type: { type: 'string' },
      content: { type: 'string' },
      fromMemberId: { type: 'string' },
      toMemberId: { type: 'string' },
      taskId: { type: 'string' },
      payload: { type: 'object' },
    },
    required: ['content'],
  },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    const inputFromMemberId = optionalString(input, 'fromMemberId')
    if (context.teamMemberId && inputFromMemberId && inputFromMemberId !== context.teamMemberId) {
      throw new Error('fromMemberId 不匹配当前成员上下文')
    }
    const fromMemberId = context.teamMemberId ?? inputFromMemberId
    const taskId = optionalString(input, 'taskId')
    // 带 taskId 的汇报默认按 'report' 处理：任务汇报应进入 Leader 唤醒白名单，避免默认 'message' 静默。
    const type = optionalString(input, 'type') ?? (taskId ? 'report' : 'message')
    // 未绑任务的汇报/结果：不会随任务状态进入 Master 的判断链路（等于静默丢报），直接拒收并说清原因。
    if (!taskId && (type === 'report' || type === 'result')) {
      throw new Error(
        `team.mailbox.send: type=${type} 属于任务汇报，必须带 taskId —— 未绑任务的汇报不会投递（无法随任务状态唤醒 Master）。`
        + '请补上本次汇报对应的 taskId；若确实没有对应任务，请改用 type=message（只进本线邮箱，不唤醒）或 type=question/blocked（会唤醒 Master）。',
      )
    }
    const message = teamService.sendMailbox({
      teamId,
      type,
      content: requireString(input, 'content'),
      fromMemberId,
      toMemberId: optionalString(input, 'toMemberId'),
      taskId,
      payload: input.payload,
      sourceSessionId: context.sessionId,
    })
    return jsonResult({ message, lineScope: { conversationId: message.conversation_id } })
  },
}

export const listTeamTasksHandler: ToolHandler = {
  name: 'team.task.list',
  description: '查看本会话线的 Team 关联任务（按会话线硬隔离，不含他线任务）',
  inputSchema: { type: 'object', properties: { teamId: { type: 'string' }, status: { type: 'string' } } },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    const scope = lineScopeFor(teamId, context)
    return jsonResult({
      tasks: teamService.listTasksForLine(teamId, scope, optionalString(input, 'status')),
      lineScope: describeLineScope(scope),
    })
  },
}

export const createTeamTaskHandler: ToolHandler = {
  name: 'team.task.create',
  description: '创建 Team 任务，可指派成员',
  inputSchema: {
    type: 'object',
    properties: {
      teamId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      assigneeMemberId: { type: 'string' },
    },
    required: ['title'],
  },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    const task = teamService.createTask({
      teamId,
      title: requireString(input, 'title'),
      description: optionalString(input, 'description'),
      assigneeMemberId: optionalString(input, 'assigneeMemberId'),
      sourceSessionId: context.sessionId,
    })
    return jsonResult({ task })
  },
}

export const updateTeamTaskHandler: ToolHandler = {
  name: 'team.task.update',
  description: '更新 Team 任务状态、阶段或指派成员',
  inputSchema: {
    type: 'object',
    properties: {
      teamId: { type: 'string' },
      taskId: { type: 'string' },
      status: { type: 'string' },
      stage: { type: 'string' },
      assigneeMemberId: { type: 'string' },
    },
    required: ['taskId'],
  },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    const task = teamService.updateTask({
      teamId,
      taskId: requireString(input, 'taskId'),
      status: optionalString(input, 'status'),
      stage: optionalString(input, 'stage'),
      assigneeMemberId: optionalNullableString(input, 'assigneeMemberId'),
      actor: { teamMemberId: context.teamMemberId },
    })
    return jsonResult({ task })
  },
}

export const listTeamTemplatesHandler: ToolHandler = {
  name: 'team.template.list',
  description: '列出可用于 spawn 的 Agent 模板',
  inputSchema: { type: 'object', properties: {} },
  async execute() {
    return jsonResult({ templates: teamService.listTemplates() })
  },
}

export const describeTeamTemplateHandler: ToolHandler = {
  name: 'team.template.describe',
  description: '查看 Agent 模板能力说明',
  inputSchema: { type: 'object', properties: { templateId: { type: 'string' } }, required: ['templateId'] },
  async execute(input) {
    return jsonResult({ template: teamService.describeTemplate(requireString(input, 'templateId')) })
  },
}

function resolveTeamId(input: ToolHandlerInput, context: ToolContext): string {
  const teamId = optionalString(input, 'teamId') ?? context.teamId
  if (!teamId) throw new Error('teamId 不能为空')
  return teamId
}

function resolveProjectId(input: ToolHandlerInput, context: ToolContext): string | undefined {
  return context.projectId ?? optionalString(input, 'projectId')
}

function assertTeamAccess(teamId: string, context: ToolContext): void {
  assertTeamMemberAccess(context, teamId)
  teamService.assertAccess(teamId, {
    projectId: context.projectId,
    teamId: context.teamId,
    teamMemberId: context.teamMemberId,
  })
}

/**
 * 只读工具的会话线隔离范围（团队邮箱硬隔离 v3）：调用会话所在线 → 成员主格线 → 团队默认线；
 * 团队没有任何活跃线时直接拒绝（不退回"看全团队"——那正是串线的来源）。
 */
function lineScopeFor(teamId: string, context: ToolContext): AgentLineScope {
  return teamService.lineScope(teamId, { sessionId: context.sessionId, teamMemberId: context.teamMemberId })
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

function optionalNullableString(input: ToolHandlerInput, key: string): string | null | undefined {
  if (!(key in input)) return undefined
  const value = input[key]
  return typeof value === 'string' ? value : null
}

function optionalNumber(input: ToolHandlerInput, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
