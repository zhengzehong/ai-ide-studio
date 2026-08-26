import { describe, expect, test } from 'vitest'
import type { TaskData } from '../../ui/src/stores/task.store.ts'
import {
  appendWorkspaceTaskPage,
  createWorkspaceTaskPageState,
  patchWorkspaceTaskPages,
  workspaceTaskPageQuery,
} from '../../ui/src/pages/workspace/task-collab/workspace-task-page-state.ts'

describe('workspace task page state', () => {
  test('builds separate local-day queries for today and history', () => {
    const now = new Date('2026-08-26T08:00:00+08:00')

    expect(workspaceTaskPageQuery('today', 'project-a', true, now)).toMatchObject({
      projectId: 'project-a',
      createdFrom: '2026-08-25T16:00:00.000Z',
      excludeTerminal: true,
      limit: 50,
    })
    expect(workspaceTaskPageQuery('history', 'project-a', false, now)).toMatchObject({
      projectId: 'project-a',
      createdBefore: '2026-08-25T16:00:00.000Z',
      excludeTerminal: false,
      limit: 50,
    })
  })

  test('appends pages by task ID and advances from the last loaded task', () => {
    const initial = createWorkspaceTaskPageState()
    const first = appendWorkspaceTaskPage(initial, {
      items: [task('task-c'), task('task-b')],
      total: 3,
      hasMore: true,
      nextCursor: 'task-b',
    })
    const second = appendWorkspaceTaskPage(first, {
      items: [task('task-b'), task('task-a')],
      total: 3,
      hasMore: false,
      nextCursor: null,
    })

    expect(second.items.map((item) => item.id)).toEqual(['task-c', 'task-b', 'task-a'])
    expect(second).toMatchObject({ total: 3, hasMore: false, nextCursor: null })
  })

  test('removes newly completed hidden tasks and inserts matching new tasks', () => {
    const today = {
      ...createWorkspaceTaskPageState(),
      items: [task('task-running')],
      total: 1,
    }
    const history = createWorkspaceTaskPageState()
    const completed = patchWorkspaceTaskPages(
      { today, history },
      { id: 'task-running', status: 'completed' },
      'project-a',
      true,
      new Date('2026-08-26T12:00:00+08:00'),
    )
    const inserted = patchWorkspaceTaskPages(
      completed,
      task('task-new'),
      'project-a',
      true,
      new Date('2026-08-26T12:00:00+08:00'),
    )

    expect(inserted.today.items.map((item) => item.id)).toEqual(['task-new'])
    expect(inserted.today.total).toBe(1)
  })
})

function task(id: string): TaskData {
  return {
    id,
    title: id,
    description: null,
    source: 'human',
    status: 'running',
    stage: '',
    assigned_agent_id: null,
    created_at: '2026-08-26T02:00:00.000Z',
    completed_at: null,
    project_id: 'project-a',
    team_id: null,
    assignee_member_id: null,
    rule_id: null,
    agent_report_status: null,
    execution_mode_id: null,
    initiator_agent_id: null,
    initiator_session_id: null,
  }
}
