import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { teamMemberStore, teamStore } from '../store/teams.js'
import { teamIdentityTransitionStore } from '../store/team-identity-transition.js'
import { taskStore } from '../store/tasks.js'
import { copyTeamAgent } from './team-member-identity.js'
import { isTeamInternalAgent } from './team-access.js'
import { applyToolProfileToAgent } from '../tools/team-profiles.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('team-identity-transition')

export function reconcileTeamIdentities(): { migrated: number; deferred: number } {
  const teams = teamStore.list()
  const members = teams.flatMap(team => teamMemberStore.list(team.id))
  const sharedSessions = new Set(members.flatMap(member => teamIdentityTransitionStore.links(member.id))
    .filter(link => teamIdentityTransitionStore.owners(link.session_id) > 1).map(link => link.session_id))
  let migrated = 0
  let deferred = 0
  for (const member of members) {
    const old = agentStore.get(member.agent_id)
    if (!old) continue
    if (isTeamInternalAgent(old) && members.filter(item => item.agent_id === old.id).length === 1) continue
    if (teamIdentityTransitionStore.busy(member.id)) {
      deferred++
      log.warn({ memberId: member.id }, '成员仍在执行，暂缓身份迁移')
      continue
    }
    teamIdentityTransitionStore.transaction(() => {
      const agent = copyTeamAgent(member.project_id, old.id, member.name)
      applyToolProfileToAgent({ profileId: member.role === 'leader' ? 'team-leader' : 'team-member', agentId: agent.id })
      const replacements = new Map<string, string>()
      const preserved = new Set<string>()
      for (const link of teamIdentityTransitionStore.links(member.id)) {
        if (replacements.has(link.session_id)) continue
        const previous = sessionStore.get(link.session_id)
        const next = link.session_id === member.session_id
          ? sessionStore.findPrimaryByAgent(agent.id)!
          : sessionStore.create({ agentId: agent.id, projectId: member.project_id, title: previous?.title ?? undefined })
        if (previous) sessionStore.updateRuntimePreferences(next.id, sessionStore.getRuntimePreferences(previous.id))
        replacements.set(link.session_id, next.id)
        const preserve = sharedSessions.has(link.session_id) || (!link.conversation_id && !isTeamInternalAgent(old))
        if (preserve) preserved.add(link.session_id)
        teamIdentityTransitionStore.replaceSession(member, link.session_id, next.id, link.conversation_id, preserve)
      }
      const primary = replacements.get(member.session_id)
      if (!primary) throw new Error('成员迁移缺少主会话映射')
      teamIdentityTransitionStore.replaceMember(member.id, agent.id, primary)
      teamIdentityTransitionStore.retargetTasks(member, agent.id, replacements, preserved)
      for (const task of taskStore.list(undefined, member.project_id).filter(task => !['completed', 'cancelled'].includes(task.status))) {
        const previous = taskStore.getExecutionSessionId(task.id, old.id)
        const replacement = previous && (!preserved.has(previous) || task.team_id === member.team_id) ? replacements.get(previous) : undefined
        const assignedMember = task.team_id === member.team_id && task.assignee_member_id === member.id
        if (!replacement && !assignedMember) continue
        if (task.assigned_agent_id === old.id) taskStore.assignAgent(task.id, agent.id)
        taskStore.setExecutionSession(task.id, agent.id, replacement || primary)
      }
      // Only execution pointers move. Native transcripts, messages and memory retain their original identity.
      log.info({ memberId: member.id, oldAgentId: old.id, agentId: agent.id, sessions: replacements.size }, '团队专属身份迁移完成')
    })
    migrated++
  }
  return { migrated, deferred }
}
