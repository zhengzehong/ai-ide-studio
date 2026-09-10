import { sessionStore, type SessionRow } from '../store/sessions.js'
import type { AgentRow } from '../store/agents.js'
import { teamMemberStore, teamStore, type TeamMemberRow, type TeamRow } from '../store/teams.js'
import { teamConversationStore, type TeamConversationRow, type TeamMessageRow } from '../store/team-conversations.js'
import { resolveSessionRuntimeState } from '../store/session-runtime-state.js'

export interface TeamConversationDetail {
  conversation: TeamConversationRow
  members: TeamMemberRow[]
  messages: TeamMessageRow[]
}

/** 会话线列表项：在原始行上附线级运行状态与格子清单（含成员格子），供前端点亮与自动选中。 */
export interface TeamConversationListItem extends TeamConversationRow {
  activity_state: 'running' | 'idle'
  grid_session_ids: string[]
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
  const activityByConversation = new Map<string, { running: boolean; sessionIds: string[] }>()
  for (const row of teamConversationStore.listGridActivity(teamId)) {
    const entry = activityByConversation.get(row.conversation_id) ?? { running: false, sessionIds: [] }
    if (row.session_id) entry.sessionIds.push(row.session_id)
    if (resolveSessionRuntimeState({
      promptActive: row.session_id ? isPromptActive(row.session_id) : false,
      hasRunningAgentMessage: row.has_running_agent_message === 1,
      hasRunningProcessItem: row.has_running_process_item === 1,
      status: row.status ?? '',
      stage: row.stage,
    }) === 'running') {
      entry.running = true
    }
    activityByConversation.set(row.conversation_id, entry)
  }
  return conversations.map((conversation) => ({
    ...conversation,
    activity_state: activityByConversation.get(conversation.id)?.running ? 'running' : 'idle',
    grid_session_ids: activityByConversation.get(conversation.id)?.sessionIds ?? [],
  }))
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
  return { conversation, members: withConversationSessions(conversation.id, members), messages: [] }
}

export function getTeamConversation(conversationId: string): TeamConversationDetail {
  const conversation = teamConversationStore.get(conversationId)
  if (!conversation) throw new Error('团队会话不存在')
  return {
    conversation,
    members: withConversationSessions(conversation.id, teamMemberStore.list(conversation.team_id)),
    messages: teamConversationStore.listMessages(conversation.id),
  }
}

function updateTeamConversationStatus(conversationId: string, status: string): TeamConversationRow {
  const conversation = teamConversationStore.setStatus(conversationId, status)
  if (!conversation) throw new Error('团队会话不存在')
  return conversation
}

export function renameTeamConversation(conversationId: string, title: string): TeamConversationRow {
  const conversation = teamConversationStore.updateTitle(conversationId, title)
  if (!conversation) throw new Error('团队会话不存在')
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
  createConversation: createTeamConversation,
  conversationDetail: getTeamConversation,
  renameConversation: renameTeamConversation,
  archiveConversation: archiveTeamConversation,
  deleteConversation: deleteTeamConversation,
}
