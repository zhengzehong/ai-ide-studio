import type { MobileConversationCatalog } from '../../../src/shared/mobile-conversations'
import type { MobileActivityGroup } from '../stores/activity.store'
import type { MobilePinnedSession } from '../stores/pinned-session.store'

export function projectTeamPins(items: MobilePinnedSession[], catalog: MobileConversationCatalog): MobilePinnedSession[] {
  const hiddenIds = new Set(catalog.hiddenSessionIds)
  const hiddenAgents = new Set(catalog.hiddenAgentIds)
  const conversations = new Map(catalog.conversations.map(c => [c.masterSessionId, c]))
  return items.flatMap(item => {
    const conversation = conversations.get(item.sessionId)
    if (conversation) return [{
      ...item, teamId: conversation.teamId, conversationId: conversation.id,
      agentId: conversation.teamId,
      agentName: catalog.teams.find(team => team.id === conversation.teamId)?.name ?? '团队',
      sessionTitle: conversation.title, activityState: conversation.running ? 'running' as const : 'idle' as const,
      unread: conversation.unread, lastActivityAt: conversation.lastMessageAt ?? conversation.createdAt,
    }]
    return hiddenIds.has(item.sessionId) || hiddenAgents.has(item.agentId) ? [] : [item]
  })
}

export function projectTeamActivity(groups: MobileActivityGroup[], catalog: MobileConversationCatalog): MobileActivityGroup[] {
  const hiddenIds = new Set(catalog.hiddenSessionIds)
  const hiddenAgents = new Set(catalog.hiddenAgentIds)
  const ordinary = groups.filter(group => !hiddenAgents.has(group.agentId))
    .map(group => ({ ...group, sessions: group.sessions.filter(session => !hiddenIds.has(session.sessionId)) }))
    .filter(group => group.sessions.length > 0)
  const teams: MobileActivityGroup[] = catalog.teams.flatMap(team => {
    const sessions = catalog.conversations.filter(c => c.teamId === team.id && (c.running || c.unread)).map(c => ({
      sessionId: c.masterSessionId, taskId: null, taskTitle: null, taskStatus: null,
      sessionTitle: c.title, status: c.status, stage: '', running: c.running,
      unread: c.unread, attentionState: c.running ? 'running' as const : 'unread' as const,
      activityAt: c.lastMessageAt ?? c.createdAt,
    }))
    if (!sessions.length) return []
    sessions.sort((a, b) => b.activityAt.localeCompare(a.activityAt))
    return [{ groupId: team.id, teamId: team.id, agentId: team.id, agentName: team.name, agentIcon: null,
      projectId: team.projectId, projectName: null, activityAt: sessions[0].activityAt, sessions }]
  })
  return [...ordinary, ...teams].sort((a, b) => b.activityAt.localeCompare(a.activityAt))
}
