import { agentStore, type AgentRow } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { teamMemberStore, teamStore, type TeamMemberRow } from '../store/teams.js'
import { teamConversationStore } from '../store/team-conversations.js'
import { teamContactStore } from '../store/team-contacts.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { teamIdentityTransitionStore } from '../store/team-identity-transition.js'
import type { TaskRow } from '../store/tasks.js'

export interface AgentAccessContext { agentId?: string; sessionId?: string; projectId?: string }
export const agentAccessScope = new AsyncLocalStorage<AgentAccessContext>()

export function assertCurrentAssignment(agentId?: string, sessionId?: string): void {
  const context = agentAccessScope.getStore()
  if (!context) return
  if (agentId) assertAgentAccess(context, agentId)
  if (sessionId) assertSessionAccess(context, sessionId)
  const member = contextMember(context)
  if (member && agentId && !teamMemberStore.list(member.team_id).some(item => item.agent_id === agentId)) {
    throw new Error('团队对外委托请通过 Master 消息，不可直接指派外部 Agent')
  }
}

export function assertTaskTeamTarget(task: TaskRow, agentId: string, sessionId?: string): void {
  const member = sessionId ? teamMemberStore.getBySession(sessionId) : undefined
  const agent = agentStore.get(agentId)
  const source = task.initiator_session_id ? teamMemberStore.getBySession(task.initiator_session_id) : undefined
  const allowedTeam = task.team_id ?? source?.team_id
  if (!allowedTeam && !member && (!agent || !isTeamInternalAgent(agent))) return
  if (!allowedTeam || (member && member.team_id !== allowedTeam)
    || !teamMemberStore.list(allowedTeam).some(item => item.agent_id === agentId && item.status === 'active')) {
    throw new Error('任务不可直接派发到团队内部，请通过 targetTeamId 联系 Master')
  }
}

export function contextMember(context: AgentAccessContext): TeamMemberRow | undefined {
  if (!context.sessionId) return undefined
  if (teamIdentityTransitionStore.history(context.sessionId)) throw new Error('团队成员身份已迁移，请进入新的成员会话')
  const session = sessionStore.get(context.sessionId)
  if (!session) throw new Error('调用会话不存在')
  if (context.agentId && session.agent_id !== context.agentId) throw new Error('调用会话身份不匹配')
  const member = teamMemberStore.getBySession(session.id)
  if (member && member.status !== 'active') throw new Error('团队成员已停用')
  if (member) assertActiveTeamSource(session.id)
  return member
}

export function assertActiveTeamSource(sessionId: string): void {
  const member = teamMemberStore.getBySession(sessionId)
  if (!member) return
  const session = sessionStore.get(sessionId)
  const team = teamStore.get(member.team_id)
  if (!session || session.status !== 'active' || session.deleted_at || session.archived_at) throw new Error('团队成员会话已关闭')
  if (!team || team.status !== 'active' || team.archived_at) throw new Error('团队已关闭')
}

export function isTeamInternalAgent(agent: AgentRow): boolean {
  const config: unknown = agent.config_json ? JSON.parse(agent.config_json) : null
  return !!config && typeof config === 'object' && 'teamInternal' in config && config.teamInternal === true
}

export function assertAgentAccess(context: AgentAccessContext, agentId: string): void {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent 不存在: ${agentId}`)
  if (context.projectId && agent.project_id !== context.projectId) throw new Error('Agent 不属于当前项目')
  if (!isTeamInternalAgent(agent)) return
  const member = contextMember(context)
  if (member && teamMemberStore.list(member.team_id).some(item => item.agent_id === agentId)) return
  throw new Error('团队内部 Agent 不可直接访问，请使用 team.list 和 targetTeamId')
}

export function assertSessionAccess(context: AgentAccessContext, sessionId: string): void {
  const target = sessionStore.get(sessionId)
  if (!target) throw new Error(`Session 不存在: ${sessionId}`)
  if (context.projectId && target.project_id !== context.projectId) throw new Error('会话不属于当前项目')
  const member = teamMemberStore.getBySession(sessionId)
  if (member) {
    const source = contextMember(context)
    if (!source || source.team_id !== member.team_id) throw new Error('不可访问团队内部会话')
    if (teamIdentityTransitionStore.history(sessionId)) return
  }
  assertAgentAccess(context, target.agent_id)
}

export function assertTeamMemberAccess(context: AgentAccessContext, teamId: string, leaderOnly = false): TeamMemberRow {
  const member = contextMember(context)
  if (!member || member.team_id !== teamId) throw new Error('仅本 Team 成员可访问内部信息或操作')
  if (leaderOnly && member.role !== 'leader') throw new Error('仅 Master 可执行此操作')
  const team = teamStore.get(teamId)
  if (!team || team.status !== 'active' || team.archived_at) throw new Error('团队已关闭')
  return member
}

export function assertMessageAccess(context: AgentAccessContext, targetSessionId: string): void {
  const source = contextMember(context)
  const target = teamMemberStore.getBySession(targetSessionId)
  const targetSession = sessionStore.get(targetSessionId)
  const targetAgent = targetSession && agentStore.get(targetSession.agent_id)
  if (!target && targetAgent && isTeamInternalAgent(targetAgent)) throw new Error('不可直发团队内部会话')
  if (source && source.role !== 'leader') throw new Error('成员请使用 team.mailbox.send，由 Master 对外联系')
  if (source && target?.team_id === source.team_id) throw new Error('团队内部请使用 mailbox 或 team.member.message')
  if (target) {
    if (target.role !== 'leader' || !context.sessionId || !teamContactStore.connects(context.sessionId, targetSessionId)) {
      throw new Error('不可直发团队内部会话，请通过 targetTeamId 建立联系')
    }
  } else if (context.sessionId && teamContactStore.hasPair(context.sessionId, targetSessionId)
    && !teamContactStore.connects(context.sessionId, targetSessionId)) {
    throw new Error('团队联系会话已关闭')
  }
  for (const sessionId of [context.sessionId, targetSessionId]) {
    if (!sessionId) continue
    const m = teamMemberStore.getBySession(sessionId)
    if (!m) continue
    const team = teamStore.get(m.team_id)
    if (!team || team.archived_at || team.status !== 'active') throw new Error('团队已关闭')
    const conversation = teamConversationStore.getBySession(sessionId)
    if (!conversation) throw new Error('团队联系必须使用活跃团队会话线')
  }
}
