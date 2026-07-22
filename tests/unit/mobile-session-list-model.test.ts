import { describe, expect, test } from 'vitest'
import type { MobileSessionItem } from '../../mobile/src/stores/session.store'
import {
  buildStableAgentGroups,
  sortProjectsByCreation,
} from '../../mobile/src/pages/session-list-model'

function session(overrides: Partial<MobileSessionItem>): MobileSessionItem {
  return {
    id: 'session-a',
    agentId: 'agent-a',
    agentName: 'Agent A',
    projectId: 'project-a',
    projectName: 'Project A',
    taskId: null,
    sessionTitle: null,
    status: 'active',
    activityState: 'idle',
    stage: '',
    unread: false,
    startedAt: '2026-07-21T00:00:00.000Z',
    updatedAt: null,
    lastMessageAt: null,
    lastReadAt: null,
    closedAt: null,
    ...overrides,
  }
}

describe('mobile session list model', () => {
  test('sorts projects by creation time and id instead of visit activity', () => {
    const projects = sortProjectsByCreation([
      { id: 'project-c', name: 'C', created_at: '2026-07-21T00:00:02.000Z', last_visited_at: '2026-07-21T00:10:00.000Z' },
      { id: 'project-b', name: 'B', created_at: '2026-07-21T00:00:01.000Z', last_visited_at: null },
      { id: 'project-a', name: 'A', created_at: '2026-07-21T00:00:01.000Z', last_visited_at: '2026-07-21T00:20:00.000Z' },
    ])

    expect(projects.map((project) => project.id)).toEqual(['project-a', 'project-b', 'project-c'])
  })

  test('keeps backend Agent order when unread and running state changes', () => {
    const agents = [
      { id: 'agent-b', name: 'Agent B' },
      { id: 'agent-a', name: 'Agent A' },
    ]
    const idle = buildStableAgentGroups(agents, [
      session({ id: 'session-a', agentId: 'agent-a', agentName: 'Agent A' }),
      session({ id: 'session-b', agentId: 'agent-b', agentName: 'Agent B' }),
    ])
    const active = buildStableAgentGroups(agents, [
      session({ id: 'session-a', agentId: 'agent-a', agentName: 'Agent A', unread: true, activityState: 'running' }),
      session({ id: 'session-b', agentId: 'agent-b', agentName: 'Agent B' }),
    ])

    expect(idle.map((group) => group.agentId)).toEqual(['agent-b', 'agent-a'])
    expect(active.map((group) => group.agentId)).toEqual(['agent-b', 'agent-a'])
  })

  test('keeps idle Agents visible and appends unknown Agents deterministically', () => {
    const groups = buildStableAgentGroups([
      { id: 'agent-b', name: 'Agent B' },
      { id: 'agent-a', name: 'Agent A' },
    ], [
      session({ id: 'session-z', agentId: 'agent-z', agentName: 'Agent Z' }),
      session({ id: 'session-c', agentId: 'agent-c', agentName: 'Agent C' }),
    ])

    expect(groups.map((group) => [group.agentId, group.sessions.length])).toEqual([
      ['agent-b', 0],
      ['agent-a', 0],
      ['agent-c', 1],
      ['agent-z', 1],
    ])
  })
})
