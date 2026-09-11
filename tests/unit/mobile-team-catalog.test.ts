import { describe, expect, it } from 'vitest'
import { mergeMobileConversations, mergeMobileOwners } from '../../mobile/src/utils/team-conversations'
import type { MobileConversationCatalog } from '../../src/shared/mobile-conversations'
import type { MobileSessionItem } from '../../mobile/src/stores/session.store'
import { projectTeamActivity, projectTeamPins } from '../../mobile/src/utils/team-list-projections'
import type { MobilePinnedSession } from '../../mobile/src/stores/pinned-session.store'

const catalog: MobileConversationCatalog = {
  teams: [{ id: 'team-1', name: '审查组', projectId: 'p1' }],
  hiddenAgentIds: ['internal'],
  hiddenSessionIds: ['member', 'master', 'archived'],
  conversations: [
    { id: 'c1', teamId: 'team-1', projectId: 'p1', masterSessionId: 'master', title: '审查一', status: 'active', running: true, unread: true, lastMessageAt: '2026-09-11T12:00:00Z', createdAt: '2026-09-10T12:00:00Z', sessionIds: ['master', 'member'] },
    { id: 'c2', teamId: 'team-1', projectId: 'p1', masterSessionId: 'master2', title: '审查二', status: 'active', running: false, unread: false, lastMessageAt: null, createdAt: '2026-09-10T12:00:00Z', sessionIds: ['master2'] },
  ],
}
const ordinary = { id: 'ordinary', agentId: 'a1', projectId: 'p1', status: 'active' } as MobileSessionItem

describe('mobile unified conversations', () => {
  it('projects pinned Master sessions without exposing member pins or losing pin order', () => {
    const pins = ['member', 'master', 'ordinary'].map((sessionId, sortOrder) => ({ sessionId, sortOrder, agentId: 'a1' })) as MobilePinnedSession[]
    const result = projectTeamPins(pins, catalog)
    expect(result.map(item => item.sessionId)).toEqual(['master', 'ordinary'])
    expect(result[0]).toMatchObject({ teamId: 'team-1', agentName: '审查组', sortOrder: 1, unread: true, activityState: 'running' })
  })
  it('shows one team group and only conversations with activity', () => {
    const result = projectTeamActivity([{ groupId: 'g', agentId: 'internal', agentName: 'Master', agentIcon: null, projectId: 'p1', projectName: null, activityAt: '', sessions: [] }], catalog)
    expect(result).toHaveLength(1)
    expect(result[0].teamId).toBe('team-1')
    expect(result[0].sessions.map(item => item.sessionId)).toEqual(['master'])
  })
  it('keeps multiple team conversations once and suppresses all internal sessions', () => {
    const result = mergeMobileConversations([ordinary, ...['master', 'member', 'archived'].map(id => ({ ...ordinary, id }))], catalog, 'p1')
    expect(result.map(item => item.id)).toEqual(['ordinary', 'master', 'master2'])
    expect(result[1]).toMatchObject({ teamId: 'team-1', conversationId: 'c1', activityState: 'running', unread: true })
    expect(result[2].activityState).toBe('idle')
  })
  it('scopes conversations and owners to the selected project without two categories', () => {
    expect(mergeMobileConversations([], catalog, 'p2')).toEqual([])
    expect(mergeMobileOwners([{ id: 'a1', name: '开发' }, { id: 'internal', name: '成员' }], catalog, 'p1').map(owner => [owner.id, owner.kind]))
      .toEqual([['a1', 'agent'], ['team-1', 'team']])
  })
  it('does not expose team members when no active conversations remain', () => {
    const empty = { ...catalog, conversations: [] }
    expect(mergeMobileConversations([{ ...ordinary, id: 'member' }], empty, 'p1')).toEqual([])
    expect(mergeMobileOwners([], empty, 'p1')).toHaveLength(1)
  })
})
