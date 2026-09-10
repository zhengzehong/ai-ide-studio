import { describe, expect, test } from 'vitest'
import { resolveUnifiedProjectSessionStats } from '../../ui/src/hooks/use-unified-project-session-stats.ts'

describe('unified project session stats', () => {
  test('keeps authoritative team totals instead of counting each grid locally', () => {
    const backendStats = { p: { projectId: 'p', runningCount: 1, unreadCount: 0, teams: [] } }
    expect(resolveUnifiedProjectSessionStats({ backendStats, activeProjectId: 'p', sessions: [], runningSessionIds: { a: true, b: true }, unreadSessionIds: {} })).toBe(backendStats)
  })
  test('overlays the active project from local session indicators', () => {
    const result = resolveUnifiedProjectSessionStats({
      backendStats: {
        'project-a': { projectId: 'project-a', runningCount: 9, unreadCount: 9 },
        'project-b': { projectId: 'project-b', runningCount: 2, unreadCount: 3 },
      },
      activeProjectId: 'project-a',
      sessions: [
        { id: 'sess-running', project_id: 'project-a', status: 'active' },
        { id: 'sess-unread', project_id: 'project-a', status: 'active' },
        { id: 'sess-secretary', project_id: 'project-a', status: 'active', purpose: 'secretary_chat' },
        { id: 'sess-advisor', project_id: 'project-a', status: 'active', purpose: 'advisor_runtime' },
        { id: 'sess-inspiration', project_id: 'project-a', status: 'active', purpose: 'inspiration_runtime' },
        { id: 'sess-other', project_id: 'project-b', status: 'active' },
      ],
      runningSessionIds: { 'sess-running': true, 'sess-secretary': true, 'sess-advisor': true },
      unreadSessionIds: { 'sess-running': true, 'sess-unread': true, 'sess-secretary': true, 'sess-other': true, 'sess-inspiration': true },
    })

    expect(result).toEqual({
      'project-a': { projectId: 'project-a', runningCount: 1, unreadCount: 1 },
      'project-b': { projectId: 'project-b', runningCount: 2, unreadCount: 3 },
    })
  })

  test('returns backend summaries unchanged without an active project', () => {
    const backendStats = {
      'project-a': { projectId: 'project-a', runningCount: 1, unreadCount: 2 },
    }

    expect(resolveUnifiedProjectSessionStats({
      backendStats,
      activeProjectId: null,
      sessions: [],
      runningSessionIds: {},
      unreadSessionIds: {},
    })).toBe(backendStats)
  })
})
