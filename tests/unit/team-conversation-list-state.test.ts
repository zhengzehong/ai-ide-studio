import { describe, expect, it } from 'vitest'
import { isTeamConversationRunning, resolveTeamConversationIndicators, sortTeamConversations, teamConversationListNeedsRefresh } from '../../ui/src/components/team/team-conversation-state'

describe('team conversation pinned-first ordering', () => {
  const lines = [
    { id: 'c1', master_session_id: 'm1' },
    { id: 'c2', master_session_id: 'm2' },
    { id: 'c3', master_session_id: 'm3' },
  ]

  it('keeps the server order untouched when nothing is pinned', () => {
    expect(sortTeamConversations(lines, new Set())).toEqual(lines)
  })

  it('moves pinned lines to the front and keeps the rest in updated_at order', () => {
    expect(sortTeamConversations(lines, new Set(['m3'])).map(line => line.id)).toEqual(['c3', 'c1', 'c2'])
    expect(sortTeamConversations(lines, new Set(['m2', 'm3'])).map(line => line.id)).toEqual(['c2', 'c3', 'c1'])
  })

  it('does not mutate the incoming rows and tolerates a missing pinned line', () => {
    const source = [...lines]
    expect(sortTeamConversations(source, new Set(['m-other'])).map(line => line.id)).toEqual(['c1', 'c2', 'c3'])
    expect(source).toEqual(lines)
  })
})

describe('team conversation running indicator', () => {
  it('does not reload the conversation list for mailbox or task progress', () => {
    expect(teamConversationListNeedsRefresh({ data: { reason: 'mailbox.created' } })).toBe(false)
    expect(teamConversationListNeedsRefresh({ data: { reason: 'task.updated' } })).toBe(false)
    expect(teamConversationListNeedsRefresh({ data: { reason: 'member.created' } })).toBe(true)
    expect(teamConversationListNeedsRefresh({ data: { conversationId: 'c', status: 'deleted' } })).toBe(true)
  })
  it('lets explicit idle for every grid override a stale running snapshot', () => {
    expect(isTeamConversationRunning({ master_session_id: 'm', activity_state: 'running', grid_session_ids: ['m', 'w'] }, {}, { m: 'idle', w: 'idle' })).toBe(false)
  })
  const conversation = { master_session_id: 'master-1', activity_state: null as 'running' | 'idle' | null }

  it('does not treat an active unarchived conversation as running', () => {
    expect(isTeamConversationRunning(conversation, {})).toBe(false)
  })

  it('uses the live running session map for the master session', () => {
    expect(isTeamConversationRunning(conversation, { 'master-1': true })).toBe(true)
  })

  it('uses persisted activity_state when the live map is not populated', () => {
    expect(isTeamConversationRunning({ ...conversation, activity_state: 'running' }, {})).toBe(true)
    expect(isTeamConversationRunning({ ...conversation, activity_state: 'idle' }, {})).toBe(false)
  })

  it('supports activity state supplied by the session store', () => {
    expect(isTeamConversationRunning(conversation, {}, { 'master-1': 'running' })).toBe(true)
    expect(isTeamConversationRunning(conversation, {}, { 'master-1': 'idle' })).toBe(false)
  })

  it('treats a running member grid as the conversation running', () => {
    expect(isTeamConversationRunning({ ...conversation, grid_session_ids: ['grid-1', 'grid-2'] }, { 'grid-2': true })).toBe(true)
    expect(isTeamConversationRunning({ ...conversation, grid_session_ids: ['grid-1'] }, { 'grid-1': true })).toBe(true)
  })

  it('ignores idle member grids', () => {
    expect(isTeamConversationRunning({ ...conversation, grid_session_ids: ['grid-1'] }, {})).toBe(false)
    expect(isTeamConversationRunning({ ...conversation, grid_session_ids: ['grid-1'], activity_state: 'idle' }, {})).toBe(false)
  })

  it('keeps the persisted activity_state as the baseline over idle grids', () => {
    expect(isTeamConversationRunning({ ...conversation, activity_state: 'running', grid_session_ids: ['grid-1'] }, {})).toBe(true)
  })
})

describe('team conversation line indicators', () => {
  const active = { master_session_id: 'master-1', status: 'active', activity_state: 'running' as const, unread: true }

  it('prefers the server activity snapshot over live signals', () => {
    expect(resolveTeamConversationIndicators(active, { running: false, unread: true }, {})).toEqual({ running: false, unread: true })
    expect(resolveTeamConversationIndicators(active, { running: true, unread: false }, {})).toEqual({ running: true, unread: false })
  })

  it('falls back to live signals and the line own unread flag', () => {
    expect(resolveTeamConversationIndicators({ master_session_id: 'master-1', status: 'active' }, undefined, { 'master-1': true })).toEqual({ running: true, unread: false })
    expect(resolveTeamConversationIndicators({ master_session_id: 'master-1', status: 'active', unread: true }, undefined, {})).toEqual({ running: false, unread: true })
  })

  it('never lights an archived line even when activity still reports it running', () => {
    // 归档瞬间服务端快照可能还没更新；归档线必须立即灭绿、去未读（总数仍含这条线）。
    expect(resolveTeamConversationIndicators({ ...active, status: 'archived' }, { running: true, unread: true }, { 'master-1': true })).toEqual({ running: false, unread: false })
    expect(resolveTeamConversationIndicators({ ...active, status: 'deleted' }, undefined, { 'master-1': true })).toEqual({ running: false, unread: false })
    expect(resolveTeamConversationIndicators({ master_session_id: 'master-1', status: 'active' }, { running: true, unread: false }, {})).toEqual({ running: true, unread: false })
  })
})
