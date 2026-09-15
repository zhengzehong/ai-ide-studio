import { sessionStore, type SessionRow } from '../store/sessions.js'
import type { AgentRow } from '../store/agents.js'
import { teamMemberStore, teamStore, type TeamMemberRow, type TeamRow } from '../store/teams.js'
import { teamConversationStore, type TeamConversationRow, type TeamMessageRow } from '../store/team-conversations.js'
import { listTeamActivity } from '../store/team-activity.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('team-conversations')
function notifyConversationChanged(conversation: TeamConversationRow): void {
  const sessionIds = teamConversationStore.listMembers(conversation.id).flatMap(member => member.session_id ? [member.session_id] : [])
  events.emit('team:update', { teamId: conversation.team_id, sessionIds, data: { conversationId: conversation.id, status: conversation.status } })
  log.info({ teamId: conversation.team_id, conversationId: conversation.id, status: conversation.status }, 'Team conversation changed')
}

export interface TeamConversationDetail {
  conversation: TeamConversationRow
  members: TeamMemberRow[]
  /**
   * 已移除但本线仍有格子的成员：仅供群聊聚合视图保留其历史消息（DB 关系为软删除），
   * 不参与 dock 成员行与成员交互。
   */
  removedMembers: TeamMemberRow[]
  messages: TeamMessageRow[]
}

/** 会话线列表项：在原始行上附线级运行状态与格子清单（含成员格子），供前端点亮与自动选中。 */
export interface TeamConversationListItem extends TeamConversationRow {
  activity_state: 'running' | 'idle'
  grid_session_ids: string[]
  unread: boolean
  last_message_at: string | null
}

function requireTeam(teamId: string): TeamRow {
  const team = teamStore.get(teamId)
  if (!team) throw new Error(`Team 不存在: ${teamId}`)
  return team
}

export function resolveTeamLeaderSession(leaderSessionId: string | undefined, leader: AgentRow, projectId: string): SessionRow {
  if (!leaderSessionId) return sessionStore.create({ agentId: leader.id, projectId })
  const session = sessionStore.get(leaderSessionId)
  if (!session) throw new Error(`Session 不存在: ${leaderSessionId}`)
  if (session.agent_id !== leader.id) throw new Error('Leader session 不属于当前 Agent')
  if (session.project_id !== projectId) throw new Error('Leader session 不属于当前项目')
  return session
}

function withConversationSessions(conversationId: string, members: TeamMemberRow[]): TeamMemberRow[] {
  const sessions = new Map(teamConversationStore.listMembers(conversationId).map((entry) => [entry.member_id, entry.session_id]))
  return members.map((member) => ({ ...member, session_id: sessions.get(member.id) ?? member.session_id }))
}

/**
 * 解析成员进入某条会话线时应使用的 session id（"线 × 成员 = 格子"模型）。
 * - 成员已参与其他活跃线 → 本线新建独立 session；
 * - 首次进线 → 复用 primary session（member.session_id，消除第一期遗留的"孤儿 master"），
 *   但 primary 已有消息（外部 leader 带历史会话等）时新建，避免历史串线。
 */
function resolveMemberConversationSession(member: TeamMemberRow): string {
  if (teamConversationStore.listMemberGrids(member.id).length > 0) {
    return sessionStore.create({ agentId: member.agent_id, projectId: member.project_id }).id
  }
  const primary = member.session_id ? sessionStore.get(member.session_id) : undefined
  if (primary && primary.project_id === member.project_id && !primary.last_message_at) return primary.id
  return sessionStore.create({ agentId: member.agent_id, projectId: member.project_id }).id
}

/** 确保成员在某条活跃会话线里有格子，返回该成员在此线的 session id。 */
export function ensureMemberInConversation(conversationId: string, member: TeamMemberRow): string | undefined {
  const existing = teamConversationStore.listMembers(conversationId).find((entry) => entry.member_id === member.id)
  if (existing?.session_id) return existing.session_id
  const sessionId = resolveMemberConversationSession(member)
  teamConversationStore.addMember(conversationId, member.id, sessionId)
  return sessionId
}

/** 把成员补登记进该团队所有活跃会话线（召唤成员时调用，避免成员掉出已有会话线）。 */
export function ensureMemberInActiveConversations(teamId: string, member: TeamMemberRow): void {
  for (const conversation of teamConversationStore.list(teamId)) {
    if (conversation.status !== 'active') continue
    ensureMemberInConversation(conversation.id, member)
  }
}

export function listTeamConversations(
  teamId: string,
  isPromptActive: (sessionId: string) => boolean = () => false,
): TeamConversationListItem[] {
  requireTeam(teamId)
  const conversations = teamConversationStore.list(teamId)
  if (conversations.length === 0) return []
  return withConversationActivity(teamId, conversations, isPromptActive)
}

/**
 * 线级运行状态聚合：线内任一格子（含成员格子）running → 线 running。
 * 判定与单人绿点同一套 resolveSessionRuntimeState 信号，保证侧栏、统计、聊天窗口径一致。
 */
function withConversationActivity(
  teamId: string,
  conversations: TeamConversationRow[],
  isPromptActive: (sessionId: string) => boolean,
): TeamConversationListItem[] {
  const activityByConversation = new Map(listTeamActivity(isPromptActive, teamId)
    .flatMap(team => team.conversations).map(item => [item.conversationId, item]))
  return conversations.map((conversation) => ({
    ...conversation,
    activity_state: activityByConversation.get(conversation.id)?.running ? 'running' : 'idle',
    grid_session_ids: activityByConversation.get(conversation.id)?.sessionIds ?? [],
    unread: activityByConversation.get(conversation.id)?.unread ?? false,
    last_message_at: activityByConversation.get(conversation.id)?.lastMessageAt ?? null,
  }))
}

/**
 * 深链反查：session → 会话线（仅 master session 命中）。
 * 供"坞里点团队线 / 带 sessionId 的链接"显式映射进团队线视图用；不是"自动选中"语义——
 * 只解析调用方明确给出的 session，绝不替用户挑线。
 */
export function findTeamConversationByMasterSession(
  sessionId: string,
  isPromptActive: (sessionId: string) => boolean = () => false,
): TeamConversationListItem | null {
  const row = teamConversationStore.getBySession(sessionId)
  if (!row || row.master_session_id !== sessionId || row.status !== 'active') return null
  const team = teamStore.get(row.team_id)
  if (!team || team.status !== 'active') return null
  return withConversationActivity(row.team_id, [row], isPromptActive)[0] ?? null
}

export function createTeamConversation(teamId: string, title?: string): TeamConversationDetail {
  const team = requireTeam(teamId)
  const members = teamMemberStore.list(team.id)
  const leader = members.find((member) => member.role === 'leader') ?? members[0]
  if (!leader) throw new Error('Team 没有 Master 成员')
  // Master 的格子即本线 master session：首次开线复用其 primary session，不再新建第二个 master。
  const masterSessionId = resolveMemberConversationSession(leader)
  const conversation = teamConversationStore.create(team.id, masterSessionId, title ?? '')
  for (const member of members) {
    const sessionId = member.id === leader.id ? masterSessionId : resolveMemberConversationSession(member)
    teamConversationStore.addMember(conversation.id, member.id, sessionId)
  }
  notifyConversationChanged(conversation)
  return { conversation, members: withConversationSessions(conversation.id, members), removedMembers: [], messages: [] }
}

export function getTeamConversation(conversationId: string): TeamConversationDetail {
  const conversation = teamConversationStore.get(conversationId)
  if (!conversation) throw new Error('团队会话不存在')
  const allMembers = teamMemberStore.listAll(conversation.team_id)
  const gridMemberIds = new Set(teamConversationStore.listMembers(conversation.id).map((entry) => entry.member_id))
  return {
    conversation,
    members: withConversationSessions(conversation.id, allMembers.filter((member) => member.status !== 'removed')),
    removedMembers: withConversationSessions(
      conversation.id,
      allMembers.filter((member) => member.status === 'removed' && gridMemberIds.has(member.id)),
    ),
    messages: teamConversationStore.listMessages(conversation.id),
  }
}

function updateTeamConversationStatus(conversationId: string, status: string): TeamConversationRow {
  const conversation = teamConversationStore.setStatus(conversationId, status)
  if (!conversation) throw new Error('团队会话不存在')
  notifyConversationChanged(conversation)
  return conversation
}

export function renameTeamConversation(conversationId: string, title: string): TeamConversationRow {
  const conversation = teamConversationStore.updateTitle(conversationId, title)
  if (!conversation) throw new Error('团队会话不存在')
  notifyConversationChanged(conversation)
  return conversation
}

export function archiveTeamConversation(conversationId: string): TeamConversationRow {
  return updateTeamConversationStatus(conversationId, 'archived')
}

export function deleteTeamConversation(conversationId: string): TeamConversationRow {
  return updateTeamConversationStatus(conversationId, 'deleted')
}

export const teamConversationService = {
  listConversations: listTeamConversations,
  conversationByMasterSession: findTeamConversationByMasterSession,
  createConversation: createTeamConversation,
  conversationDetail: getTeamConversation,
  renameConversation: renameTeamConversation,
  archiveConversation: archiveTeamConversation,
  deleteConversation: deleteTeamConversation,
}
