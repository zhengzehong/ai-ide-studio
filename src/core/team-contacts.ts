import { agentStore, type AgentRow } from '../store/agents.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { teamMemberStore, teamStore } from '../store/teams.js'
import { teamConversationStore } from '../store/team-conversations.js'
import { teamContactStore } from '../store/team-contacts.js'
import { createTeamConversation } from './team-conversations.js'
import { contextMember, type AgentAccessContext } from './team-access.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('team-contacts')

export function resolveTeamContact(context: AgentAccessContext, teamId: string): SessionRow {
  const source = requireSource(context)
  const member = contextMember(context)
  if (member && (member.role !== 'leader' || member.team_id === teamId)) throw new Error('团队内部请使用 mailbox，对外由 Master 联系')
  if (member && !teamConversationStore.getBySession(source.id)) throw new Error('Master 对外联系必须来自活跃团队会话线')
  const team = teamStore.get(teamId)
  if (!team || team.status !== 'active' || team.archived_at) throw new Error('团队不存在或已关闭')
  if ((context.projectId ?? source.project_id) !== team.project_id) throw new Error('团队不属于当前项目')
  const connected = teamContactStore.listConversationIds(source.id, teamId)
  if (connected.length > 1) throw new Error('存在多条联系，请从 team.conversation.list 选择 targetSessionId')
  const conversationId = connected[0] ?? teamContactStore.ensure({ projectId: team.project_id, sourceSessionId: source.id, teamId },
    () => createTeamConversation(teamId, `来自 ${publicSender(source.id).name} 的联系`).conversation).conversation_id
  const conversation = teamConversationStore.get(conversationId)
  if (!conversation || conversation.status !== 'active') throw new Error('团队联系会话已关闭')
  const session = sessionStore.get(conversation.master_session_id)
  const master = session && teamMemberStore.getBySession(session.id)
  if (!session || session.status !== 'active' || master?.role !== 'leader' || master.team_id !== teamId) throw new Error('团队 Master 会话不可用')
  log.info({ teamId, sourceSessionId: source.id, targetSessionId: session.id, conversationId }, '已解析团队联系')
  return session
}

export function registerMasterOutbound(context: AgentAccessContext, target: SessionRow): void {
  const member = contextMember(context)
  if (!member || member.role !== 'leader' || teamMemberStore.getBySession(target.id)) return
  const conversation = context.sessionId && teamConversationStore.getBySession(context.sessionId)
  if (!conversation || conversation.master_session_id !== context.sessionId) throw new Error('Master 对外联系必须来自活跃团队会话线')
  const team = teamStore.get(member.team_id)
  if (!team || team.status !== 'active' || team.archived_at) throw new Error('团队已关闭')
  const contact = teamContactStore.ensure({
    projectId: member.project_id, sourceSessionId: target.id, teamId: member.team_id,
  }, () => conversation)
  if (contact.conversation_id !== conversation.id) throw new Error('该外部会话已关联其他团队会话线，请在对应会话线继续联系')
}

export function listPublicTeamConversations(context: AgentAccessContext, teamId: string): object[] {
  const source = requireSource(context)
  const team = teamStore.get(teamId)
  if (!team || (context.projectId ?? source.project_id) !== team.project_id) throw new Error('团队不属于当前项目')
  const member = contextMember(context)
  const connected = new Set(teamContactStore.listConversationIds(source.id, teamId))
  const own = member?.team_id === teamId
  return teamConversationStore.list(teamId)
    .filter(row => own || connected.has(row.id))
    .map(row => ({ conversationId: row.id, teamId, title: row.title, status: row.status, sessionId: row.master_session_id }))
}

export function publicSender(sessionId: string): AgentRow {
  const session = sessionStore.get(sessionId)
  const agent = session && agentStore.get(session.agent_id)
  if (!agent) throw new Error('消息来源 Agent 不存在')
  const member = teamMemberStore.getBySession(sessionId)
  const team = member && teamStore.get(member.team_id)
  return team ? { ...agent, id: team.id, name: team.name } : agent
}

function requireSource(context: AgentAccessContext): SessionRow {
  const session = context.sessionId && sessionStore.get(context.sessionId)
  if (!session || !context.agentId || session.agent_id !== context.agentId) throw new Error('缺少有效调用会话')
  if (session.status !== 'active' || session.deleted_at || session.archived_at) throw new Error('当前会话已关闭')
  return session
}
