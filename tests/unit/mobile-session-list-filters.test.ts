import { describe, expect, test } from 'vitest'
import type { MobileSessionItem } from '../../mobile/src/stores/session.store.ts'
import { filterAndSortMobileSessions } from '../../mobile/src/utils/session-list-filters.ts'

function session(overrides: Partial<MobileSessionItem> & Pick<MobileSessionItem, 'id'>): MobileSessionItem {
  return {
    id: overrides.id,
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
    startedAt: '2026-06-12T08:00:00.000Z',
    updatedAt: null,
    lastMessageAt: null,
    closedAt: null,
    ...overrides,
  }
}

describe('mobile session list filters', () => {
  test('defaults to all sessions sorted by recent activity', () => {
    const result = filterAndSortMobileSessions([
      session({ id: 'older', startedAt: '2026-06-12T08:00:00.000Z' }),
      session({ id: 'newer-message', lastMessageAt: '2026-06-12T10:00:00.000Z' }),
      session({ id: 'middle-update', updatedAt: '2026-06-12T09:00:00.000Z' }),
    ], {
      agentId: null,
      status: 'all',
      sort: 'recent',
    })

    expect(result.map((item) => item.id)).toEqual(['newer-message', 'middle-update', 'older'])
  })

  test('filters sessions by selected agent', () => {
    const result = filterAndSortMobileSessions([
      session({ id: 'agent-a-session', agentId: 'agent-a' }),
      session({ id: 'agent-b-session', agentId: 'agent-b', agentName: 'Agent B' }),
    ], {
      agentId: 'agent-b',
      status: 'all',
      sort: 'recent',
    })

    expect(result.map((item) => item.id)).toEqual(['agent-b-session'])
  })

  test('filters running sessions', () => {
    const result = filterAndSortMobileSessions([
      session({ id: 'idle-session', activityState: 'idle' }),
      session({ id: 'running-session', activityState: 'running' }),
    ], {
      agentId: null,
      status: 'running',
      sort: 'recent',
    })

    expect(result.map((item) => item.id)).toEqual(['running-session'])
  })

  test('filters unread sessions', () => {
    const result = filterAndSortMobileSessions([
      session({ id: 'read-session', unread: false }),
      session({ id: 'unread-session', unread: true }),
    ], {
      agentId: null,
      status: 'unread',
      sort: 'recent',
    })

    expect(result.map((item) => item.id)).toEqual(['unread-session'])
  })

  test('filters closed sessions', () => {
    const result = filterAndSortMobileSessions([
      session({ id: 'active-session', status: 'active' }),
      session({ id: 'closed-session', status: 'closed', closedAt: '2026-06-12T11:00:00.000Z' }),
    ], {
      agentId: null,
      status: 'closed',
      sort: 'recent',
    })

    expect(result.map((item) => item.id)).toEqual(['closed-session'])
  })

  test('sorts by created time when selected', () => {
    const result = filterAndSortMobileSessions([
      session({
        id: 'started-earlier',
        startedAt: '2026-06-12T08:00:00.000Z',
        lastMessageAt: '2026-06-12T11:00:00.000Z',
      }),
      session({
        id: 'started-later',
        startedAt: '2026-06-12T09:00:00.000Z',
      }),
    ], {
      agentId: null,
      status: 'all',
      sort: 'started',
    })

    expect(result.map((item) => item.id)).toEqual(['started-later', 'started-earlier'])
  })
})
