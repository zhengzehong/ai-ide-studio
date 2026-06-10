import { describe, expect, test } from 'vitest'
import { mobileSessionIndicator } from '../../mobile/src/utils/session-indicator.ts'
import type { WidgetSessionItem } from '../../ui/src/stores/widget.store.ts'

function session(overrides: Partial<WidgetSessionItem> = {}): WidgetSessionItem {
  return {
    sessionId: 'sess-1',
    agentId: 'agent-1',
    agentName: 'Codex',
    agentIcon: null,
    projectId: 'project-1',
    projectName: 'Project',
    taskId: null,
    taskTitle: null,
    sessionTitle: 'Fix mobile app',
    status: 'active',
    activityState: 'idle',
    stage: '',
    unread: false,
    startedAt: '2026-06-10T00:00:00.000Z',
    lastMessageAt: null,
    completedAt: null,
    closedAt: null,
    ...overrides,
  }
}

describe('mobile session indicator', () => {
  test('prioritizes running state with a green pulsing indicator', () => {
    expect(mobileSessionIndicator(session({ activityState: 'running', unread: true }))).toMatchObject({
      color: 'var(--success)',
      pulse: true,
      label: '执行中',
      title: '正在执行',
    })
  })

  test('shows unread idle sessions with a yellow indicator', () => {
    expect(mobileSessionIndicator(session({ unread: true }))).toMatchObject({
      color: 'var(--warning)',
      pulse: false,
      label: '有新回复',
      title: '有新回复',
    })
  })

  test('does not show stale running stage text for idle active sessions', () => {
    const indicator = mobileSessionIndicator(session({ stage: '正在思考...' }))

    expect(indicator.label).toBe('可用')
    expect(indicator.label).not.toBe('正在思考...')
    expect(indicator.pulse).toBe(false)
  })
})
