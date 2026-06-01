import { teamService } from '../../../core/teams.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listTeamsHandler: ToolHandler = {
  name: 'team.list',
  description: '列出当前项目的 Team',
  inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
  async execute(input, context) {
    return jsonResult({ teams: teamService.list(resolveProjectId(input, context)) })
  },
}

export const getTeamHandler: ToolHandler = {
  name: 'team.get',
  description: '获取 Team 详情、成员、任务和最近 mailbox',
  inputSchema: { type: 'object', properties: { teamId: { type: 'string' } }, required: ['teamId'] },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    return jsonResult(teamService.detail(teamId))
  },
}

export const createTeamHandler: ToolHandler = {
  name: 'team.create',
  description: '创建 Team，并把当前 Agent 作为初始主控成员',
  inputSchema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } },
    required: ['name'],
  },
  async execute(input, context) {
    const projectId = resolveProjectId(input, context)
    const leaderAgentId = context.agentId
    if (!projectId) throw new Error('projectId 不能为空')
    if (!leaderAgentId) throw new Error('agentId 不能为空')
    return jsonResult(
      teamService.create({
        projectId,
        leaderAgentId,
        leaderSessionId: context.sessionId,
        name: requireString(input, 'name'),
        description: optionalString(input, 'description'),
      }),
    )
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
  description: '从模板创建成员，或把已有 Agent 加入 Team',
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
      }),
    )
  },
}

export const listTeamMailboxHandler: ToolHandler = {
  name: 'team.mailbox.list',
  description: '查看团队留言、问题、结果和汇报',
  inputSchema: { type: 'object', properties: { teamId: { type: 'string' }, limit: { type: 'number' } } },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    return jsonResult({ messages: teamService.listMailbox(teamId, optionalNumber(input, 'limit')) })
  },
}

export const sendTeamMailboxHandler: ToolHandler = {
  name: 'team.mailbox.send',
  description: '写入团队留言、问题、结果或汇报，不触发 Agent 执行',
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
    const message = teamService.sendMailbox({
      teamId,
      type: optionalString(input, 'type') ?? 'message',
      content: requireString(input, 'content'),
      fromMemberId,
      toMemberId: optionalString(input, 'toMemberId'),
      taskId: optionalString(input, 'taskId'),
      payload: input.payload,
    })
    return jsonResult({ message })
  },
}

export const listTeamTasksHandler: ToolHandler = {
  name: 'team.task.list',
  description: '查看 Team 关联任务',
  inputSchema: { type: 'object', properties: { teamId: { type: 'string' }, status: { type: 'string' } } },
  async execute(input, context) {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    return jsonResult({ tasks: teamService.listTasks(teamId, optionalString(input, 'status')) })
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
  teamService.assertAccess(teamId, {
    projectId: context.projectId,
    teamId: context.teamId,
    teamMemberId: context.teamMemberId,
  })
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
