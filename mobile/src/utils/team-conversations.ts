import type { MobileConversationCatalog } from '../../../src/shared/mobile-conversations'
import type { AgentItem } from '../stores/app.store'
import type { MobileSessionItem } from '../stores/session.store'
import type { AgentGroup } from '../pages/session-list-model'

export interface MobileConversationOwner extends AgentItem { kind: 'agent' | 'team' }

export function sortConversationGroups(groups: AgentGroup[], pinnedIds: string[]): AgentGroup[] {
  const pinOrder = new Map(pinnedIds.map((id, index) => [id, index]))
  const order = (group: AgentGroup): number => Math.min(...group.sessions.map(session => pinOrder.get(session.id) ?? Infinity))
  const latest = (group: AgentGroup): number => Math.max(0, ...group.sessions.map(session => Date.parse(session.lastMessageAt || session.startedAt) || 0))
  return [...groups].sort((a, b) => {
    const aPin = order(a), bPin = order(b)
    if (aPin !== bPin) return aPin - bPin
    return latest(b) - latest(a)
  })
}

export function mergeMobileOwners(agents: AgentItem[], catalog: MobileConversationCatalog, projectId: string | null): MobileConversationOwner[] {
  const hidden = new Set(catalog.hiddenAgentIds)
  return [
    ...agents.filter(agent => !hidden.has(agent.id)).map(agent => ({ ...agent, kind: 'agent' as const })),
    ...catalog.teams.filter(team => !projectId || team.projectId === projectId).map(team => ({ id: team.id, name: team.name, kind: 'team' as const })),
  ]
}

export function mergeMobileConversations(sessions: MobileSessionItem[], catalog: MobileConversationCatalog, projectId: string | null): MobileSessionItem[] {
  const hiddenAgents = new Set(catalog.hiddenAgentIds)
  const hiddenSessions = new Set(catalog.hiddenSessionIds)
  return [
    ...sessions.filter(session => !hiddenAgents.has(session.agentId) && !hiddenSessions.has(session.id) && (!projectId || session.projectId === projectId)),
    ...catalog.conversations.filter(conversation => !projectId || conversation.projectId === projectId).map(conversation => ({
      id: conversation.masterSessionId, agentId: conversation.teamId,
      agentName: catalog.teams.find(team => team.id === conversation.teamId)?.name ?? '团队',
      teamId: conversation.teamId, conversationId: conversation.id,
      projectId: conversation.projectId, projectName: null, taskId: null,
      sessionTitle: conversation.title || '新团队会话', status: conversation.status,
      activityState: conversation.running ? 'running' as const : 'idle' as const,
      stage: '', unread: conversation.unread, startedAt: conversation.createdAt,
      updatedAt: conversation.lastMessageAt, lastMessageAt: conversation.lastMessageAt,
      lastReadAt: null, closedAt: null,
    })),
  ]
}
