import { agentSessionCommunicationService } from '../../core/agent-session-communication.js'
import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'
import { teamMemberStore } from '../../store/teams.js'

export const agentMessageSendHandler: ToolHandler = {
  name: 'agent.message.send',
  description: '向普通 Agent 或团队发送消息，异步投递后立即返回，不要等待对方完成。团队通过 team.list 查询，首次联系传 targetTeamId，后续复用联系；回复统一传来源 targetSessionId。团队成员由 Master 对外联系。普通 Agent 只传 targetAgentId 会新建会话。needReply=true 时发送后结束本轮，收到回复后自动唤醒来源会话。',
  inputSchema: {
    type: 'object',
    properties: {
      targetAgentId: { type: 'string' },
      targetTeamId: { type: 'string', description: '团队 ID；首次联系自动建线，后续复用。不可同时传其他目标。' },
      targetSessionId: { type: 'string' },
      content: { type: 'string' },
      relatedInfo: { type: 'object' },
      needReply: { type: 'boolean' },
    },
    required: ['content'],
  },
  async execute(input, context) {
    const result = await agentSessionCommunicationService.sendMessage({
      context,
      targetAgentId: optionalString(input, 'targetAgentId'),
      targetTeamId: optionalString(input, 'targetTeamId'),
      targetSessionId: optionalString(input, 'targetSessionId'),
      content: requireString(input, 'content'),
      relatedInfo: optionalRecord(input, 'relatedInfo'),
      needReply: input.needReply === true,
    })
    const targetMember = teamMemberStore.getBySession(result.targetSession.id)
    const sourceMember = context.sessionId ? teamMemberStore.getBySession(context.sessionId) : undefined
    if (targetMember || sourceMember) {
      return jsonResult({ messageId: result.message.id, status: result.message.prompt_status,
        targetSessionId: result.targetSession.id, targetTeamId: targetMember?.team_id,
        sourceTeamId: sourceMember?.team_id })
    }
    return jsonResult({ message: result.message, targetSession: result.targetSession })
  },
}

export const agentSessionListHandler: ToolHandler = {
  name: 'agent.session.list',
  description: '查看某个 Agent 在当前项目内的会话列表。',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['agentId'],
  },
  async execute(input, context) {
    const sessions = agentSessionCommunicationService.listSessions(
      requireString(input, 'agentId'),
      context.projectId,
      optionalNumber(input, 'limit'),
    )
    return jsonResult({ sessions })
  },
}

export const agentSessionMessagesHandler: ToolHandler = {
  name: 'agent.session.messages',
  description: '查看某个会话的最近消息。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['sessionId'],
  },
  async execute(input, context) {
    const messages = agentSessionCommunicationService.listMessages(
      requireString(input, 'sessionId'),
      context.projectId,
      optionalNumber(input, 'limit'),
    )
    return jsonResult({ messages })
  },
}

export const agentSessionTagsSetHandler: ToolHandler = {
  name: 'agent.session.tags.set',
  description: '设置某个会话的标签(全量替换)。标签自动去空去重,每个会话最多 10 个,单个最多 24 字符,超限直接报错;传空数组即清空全部标签。允许操作你当前所在的会话。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['sessionId', 'tags'],
  },
  async execute(input, context) {
    const session = agentSessionCommunicationService.setSessionTags(
      context,
      requireString(input, 'sessionId'),
      requireStringArray(input, 'tags'),
    )
    return jsonResult({ session })
  },
}

export const agentSessionArchiveHandler: ToolHandler = {
  name: 'agent.session.archive',
  description: '归档一个会话(从会话列表隐藏,之后可用 agent.session.unarchive 还原)。主会话、运行中的会话、系统会话会被拒绝;不能归档你当前所在的会话;已归档的会话再次归档会报错"会话已归档"。',
  inputSchema: {
    type: 'object',
    properties: { sessionId: { type: 'string' } },
    required: ['sessionId'],
  },
  async execute(input, context) {
    const session = agentSessionCommunicationService.archiveSession(context, requireString(input, 'sessionId'))
    return jsonResult({ session })
  },
}

export const agentSessionUnarchiveHandler: ToolHandler = {
  name: 'agent.session.unarchive',
  description: '还原一个已归档的会话(回到会话列表)。只能还原已归档的会话,未归档会报错"会话未归档";系统会话不可还原;不能还原你当前所在的会话。',
  inputSchema: {
    type: 'object',
    properties: { sessionId: { type: 'string' } },
    required: ['sessionId'],
  },
  async execute(input, context) {
    const session = agentSessionCommunicationService.restoreSession(context, requireString(input, 'sessionId'))
    return jsonResult({ session })
  },
}

export const agentSessionWatchHandler: ToolHandler = {
  name: 'agent.session.watch',
  description: '一次性监听另一个会话的完成事件。被监听会话执行完一轮后,系统自动唤醒你的会话。单次触发后自动失效,不支持取消。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: '被监听会话 ID' },
      relatedInfo: { type: 'object', description: '动态关联信息 JSON' },
    },
    required: ['sessionId'],
  },
  async execute(input, context) {
    const watch = agentSessionCommunicationService.createWatch({
      context,
      sessionId: requireString(input, 'sessionId'),
      once: true,
      relatedInfo: optionalRecord(input, 'relatedInfo'),
    })
    return jsonResult({ watchId: watch.id, sessionId: watch.watched_session_id })
  },
}

export const agentTaskWatchHandler: ToolHandler = {
  name: 'agent.task.watch',
  description: '持续性监听一个任务。触发时机:步骤 done / 步骤 blocked / 任务 completed / 任务回退到 draft。updateProgress/milestone/ready/pending 不触发。需要用 agent.task.watch.cancel 取消。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '被监听任务 ID' },
      relatedInfo: { type: 'object', description: '动态关联信息 JSON' },
    },
    required: ['taskId'],
  },
  async execute(input, context) {
    const watch = agentSessionCommunicationService.createTaskWatch({
      context,
      taskId: requireString(input, 'taskId'),
      relatedInfo: optionalRecord(input, 'relatedInfo'),
    })
    return jsonResult({ watchId: watch.id, taskId: watch.task_id })
  },
}

export const agentTaskWatchCancelHandler: ToolHandler = {
  name: 'agent.task.watch.cancel',
  description: '取消 agent.task.watch 创建的监听。',
  inputSchema: {
    type: 'object',
    properties: { watchId: { type: 'string', description: 'Watch ID' } },
    required: ['watchId'],
  },
  async execute(input, context) {
    const watch = agentSessionCommunicationService.cancelWatch(
      requireString(input, 'watchId'),
      context,
    )
    return jsonResult({ ok: true, cancelled: watch.id })
  },
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value.trim()
}

function requireStringArray(input: ToolHandlerInput, key: string): string[] {
  const value = input[key]
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error('tags 必须是字符串数组')
  }
  return value
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(input: ToolHandlerInput, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' ? value : undefined
}

function optionalRecord(input: ToolHandlerInput, key: string): Record<string, unknown> | undefined {
  const value = input[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
