import { expect, test } from 'vitest'
import { mergeMobileTaskUpdate, mobileTaskStatusMeta, taskListRequest } from '../../mobile/src/pages/TaskListPage'
import type { TaskStatus } from '../../src/types/ws-protocol'

test('mobile task status labels cover backend task statuses', () => {
  const cases: Array<[TaskStatus, string]> = [
    ['backlog', '待办'],
    ['executing', '执行中'],
    ['needs_input', '需确认'],
    ['completed', '已完成'],
    ['cancelled', '已取消'],
  ]

  for (const [status, label] of cases) {
    expect(mobileTaskStatusMeta(status).label).toBe(label)
  }
})

test('mobile task list request includes the selected project', () => {
  expect(taskListRequest('project-a')).toEqual({ type: 'tasks.list', projectId: 'project-a' })
  expect(taskListRequest(null)).toEqual({ type: 'tasks.list' })
})

test('mobile task updates merge, delete, and respect the selected project', () => {
  const base = [{
    id: 'task-a',
    title: 'Task A',
    status: 'backlog' as TaskStatus,
    created_at: '2026-06-10T00:00:00.000Z',
    project_id: 'project-a',
  }]

  expect(mergeMobileTaskUpdate(base, {
    id: 'task-a',
    title: 'Task A updated',
    status: 'executing',
    project_id: 'project-a',
  }, 'project-a')[0]).toMatchObject({
    id: 'task-a',
    title: 'Task A updated',
    status: 'executing',
  })

  expect(mergeMobileTaskUpdate(base, {
    id: 'task-a',
    status: 'executing',
  }, 'project-a')[0]).toMatchObject({
    id: 'task-a',
    title: 'Task A',
    status: 'executing',
    project_id: 'project-a',
  })

  expect(mergeMobileTaskUpdate(base, {
    id: 'task-b',
    title: 'Task B',
    status: 'backlog',
    created_at: '2026-06-10T00:01:00.000Z',
    project_id: 'project-a',
  }, 'project-a')[0]).toMatchObject({ id: 'task-b' })

  expect(mergeMobileTaskUpdate(base, {
    id: 'task-c',
    title: 'Task C',
    status: 'backlog',
    created_at: '2026-06-10T00:02:00.000Z',
    project_id: 'project-b',
  }, 'project-a')).toEqual(base)

  expect(mergeMobileTaskUpdate(base, { id: 'task-a', event: 'deleted' }, 'project-a')).toEqual([])
})
