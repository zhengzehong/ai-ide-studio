import { teamMemberStore, teamStore, type TeamRow } from '../store/teams.js'
import { teamConversationStore } from '../store/team-conversations.js'
import { cancelPendingForSessions } from './team-member-dispatcher.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('team-archive')

function requireTeam(teamId: string): TeamRow {
  const team = teamStore.get(teamId)
  if (!team) throw new Error(`Team 不存在: ${teamId}`)
  return team
}

/** 归档团队（软删除）：停掉活跃会话线、丢弃未派发的成员指令，teams.list 不再返回。 */
export function archiveTeam(teamId: string): TeamRow {
  const team = requireTeam(teamId)
  cancelPendingForSessions(teamMemberStore.list(team.id).map((member) => member.session_id))
  for (const conversation of teamConversationStore.list(team.id)) {
    if (conversation.status === 'active') teamConversationStore.setStatus(conversation.id, 'archived')
  }
  const archived = teamStore.archive(team.id)
  if (!archived) throw new Error(`Team 不存在: ${teamId}`)
  log.info({ teamId: team.id }, 'Team 已归档')
  events.emit('team:update', {
    teamId: team.id,
    sessionIds: teamMemberStore.list(team.id).map((member) => member.session_id),
    data: { reason: 'archived' },
  })
  return archived
}
