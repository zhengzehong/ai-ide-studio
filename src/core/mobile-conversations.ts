import { agentStore } from '../store/agents.js'
import { teamStore } from '../store/teams.js'
import { listTeamSessionIds } from '../store/mobile-conversations.js'
import { listTeamConversations } from './team-conversations.js'
import type { MobileConversationCatalog } from '../shared/mobile-conversations.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('mobile-conversations')

export function listMobileConversationCatalog(projectId: string | undefined, isPromptActive: (id: string) => boolean): MobileConversationCatalog {
  const teams = teamStore.list(projectId)
  const hiddenAgentIds = agentStore.list(projectId).filter(agent => {
    try { return (JSON.parse(agent.config_json || '{}') as { teamInternal?: boolean }).teamInternal === true }
    catch { return false }
  }).map(agent => agent.id)
  const conversations = teams.flatMap(team => listTeamConversations(team.id, isPromptActive)
    .filter(conversation => conversation.status === 'active')
    .map(conversation => ({
      id: conversation.id, teamId: team.id, projectId: team.project_id,
      masterSessionId: conversation.master_session_id, title: conversation.title,
      status: conversation.status, running: conversation.activity_state === 'running',
      unread: conversation.unread, lastMessageAt: conversation.last_message_at,
      createdAt: conversation.created_at, sessionIds: conversation.grid_session_ids,
    })))
  log.debug({ projectId, teamCount: teams.length, conversationCount: conversations.length }, 'Mobile conversation catalog loaded')
  return {
    teams: teams.map(team => ({ id: team.id, name: team.name, projectId: team.project_id })),
    conversations, hiddenAgentIds, hiddenSessionIds: listTeamSessionIds(projectId),
  }
}
