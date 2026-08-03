import { describe, expect, test } from 'vitest'
import {
  buildWidgetSessionActivityGroups,
  type WidgetSessionActivitySource,
} from '../../src/queries/widget-session-activity-query.js'

function session(
  sessionId: string,
  overrides: Partial<WidgetSessionActivitySource> = {},
): WidgetSessionActivitySource {
  return {
    sessionId,
    agentId: 'agent-1',
    agentName: 'Coder',
    agentIcon: 'code',
    projectId: 'project-1',
    projectName: 'AI IDE Studio',
    taskId: null,
    taskTitle: null,
    taskStatus: null,
    sessionTitle: sessionId,
    status: 'active',
    activityState: 'idle',
    stage: '',
    unread: false,
    startedAt: '2026-08-03T08:00:00.000Z',
    updatedAt: '2026-08-03T08:00:00.000Z',
    lastMessageAt: null,
    completedAt: null,
    closedAt: null,
    ...overrides,
  }
}

describe('Widget Session activity query', () => {
  test('keeps every running or unread Session under the same Agent and project', () => {
    const groups = buildWidgetSessionActivityGroups([
      session('running-session', {
        activityState: 'running',
        updatedAt: '2026-08-03T08:02:00.000Z',
      }),
      session('unread-session', {
        unread: true,
        lastMessageAt: '2026-08-03T08:01:00.000Z',
      }),
      session('read-session', {
        lastMessageAt: '2026-08-03T08:03:00.000Z',
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      agentId: 'agent-1',
      projectId: 'project-1',
      projectName: 'AI IDE Studio',
    })
    expect(groups[0]?.sessions.map((item) => [item.sessionId, item.attentionState])).toEqual([
      ['running-session', 'running'],
      ['unread-session', 'unread'],
    ])
  })

  test('creates separate groups when one Agent has activity in multiple projects', () => {
    const groups = buildWidgetSessionActivityGroups([
      session('studio-session', { activityState: 'running' }),
      session('gowclaw-session', {
        projectId: 'project-2',
        projectName: 'GowClaw',
        unread: true,
        lastMessageAt: '2026-08-03T08:05:00.000Z',
      }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => [group.agentId, group.projectId])).toEqual([
      ['agent-1', 'project-1'],
      ['agent-1', 'project-2'],
    ])
  })

  test('prioritizes a directly linked needs-input Task while preserving state flags', () => {
    const groups = buildWidgetSessionActivityGroups([
      session('running-session', { activityState: 'running' }),
      session('waiting-session', {
        taskId: 'task-1',
        taskTitle: 'Confirm deployment',
        taskStatus: 'needs_input',
        unread: true,
      }),
    ])

    expect(groups[0]?.sessions[0]).toMatchObject({
      sessionId: 'waiting-session',
      attentionState: 'needs_input',
      needsInput: true,
      unread: true,
      taskTitle: 'Confirm deployment',
    })
    expect(groups[0]?.sessions[1]).toMatchObject({
      sessionId: 'running-session',
      attentionState: 'running',
      running: true,
    })
  })

  test('applies the limit to Sessions without dropping siblings before the limit', () => {
    const groups = buildWidgetSessionActivityGroups([
      session('session-1', { activityState: 'running' }),
      session('session-2', { activityState: 'running' }),
      session('session-3', { activityState: 'running' }),
    ], 2)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.sessions).toHaveLength(2)
  })
})
