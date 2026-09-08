import { sessionStore, type SessionRow } from '../store/sessions.js'
import type { AgentRow } from '../store/agents.js'
import { teamMemberStore, teamStore, type TeamMemberRow, type TeamRow } from '../store/teams.js'
import { teamConversationStore, type TeamConversationRow, type TeamMessageRow } from '../store/team-conversations.js'

export interface TeamConversationDetail {
  conversation: TeamConversationRow
  members: TeamMemberRow[]
  messages: TeamMessageRow[]
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

export function listTeamConversations(teamId: string): TeamConversationRow[] {
  requireTeam(teamId)
  return teamConversationStore.list(teamId)
}

export function createTeamConversation(teamId: string, title?: string): TeamConversationDetail {
  const team = requireTeam(teamId)
  const members = teamMemberStore.list(team.id)
  const leader = members.find((member) => member.role === 'leader') ?? members[0]
  if (!leader) throw new Error('Team 没有 Master 成员')
  const masterSession = sessionStore.create({ agentId: leader.agent_id, projectId: team.project_id })
  const conversation = teamConversationStore.create(team.id, masterSession.id, title ?? '')
  for (const member of members) {
    const session = member.id === leader.id
      ? masterSession
      : sessionStore.create({ agentId: member.agent_id, projectId: team.project_id })
    teamConversationStore.addMember(conversation.id, member.id, session.id)
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
