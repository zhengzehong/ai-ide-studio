import type { AgentItem, ProjectItem } from '../stores/app.store'
import type { MobileSessionItem } from '../stores/session.store'

export interface AgentGroup {
  agentId: string
  agentName: string
  sessions: MobileSessionItem[]
  unreadCount: number
  runningCount: number
}

export function sortProjectsByCreation(projects: ProjectItem[]): ProjectItem[] {
  return [...projects].sort((left, right) => {
    const byCreation = (left.created_at ?? '').localeCompare(right.created_at ?? '')
    return byCreation || left.id.localeCompare(right.id)
  })
}

export function buildStableAgentGroups(
  agents: AgentItem[],
  sessions: MobileSessionItem[],
): AgentGroup[] {
  const groupsByAgent = new Map<string, AgentGroup>()
  const stableGroups: AgentGroup[] = []

  for (const agent of agents) {
    if (groupsByAgent.has(agent.id)) continue
    const group = createAgentGroup(agent.id, agent.name)
    groupsByAgent.set(agent.id, group)
    stableGroups.push(group)
  }

  const unknownGroups: AgentGroup[] = []
  for (const session of sessions) {
    if (session.status !== 'active') continue
    let group = groupsByAgent.get(session.agentId)
    if (!group) {
      group = createAgentGroup(session.agentId, session.agentName)
      groupsByAgent.set(session.agentId, group)
      unknownGroups.push(group)
    }
    group.sessions.push(session)
    if (session.unread) group.unreadCount += 1
    if (session.activityState === 'running') group.runningCount += 1
  }

  unknownGroups.sort((left, right) => (
    left.agentName.localeCompare(right.agentName, 'zh-CN') || left.agentId.localeCompare(right.agentId)
  ))
  return [...stableGroups, ...unknownGroups]
}

function createAgentGroup(agentId: string, agentName: string): AgentGroup {
  return {
    agentId,
    agentName,
    sessions: [],
    unreadCount: 0,
    runningCount: 0,
  }
}
