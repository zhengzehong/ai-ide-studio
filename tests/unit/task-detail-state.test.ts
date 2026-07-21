import { describe, expect, test } from 'vitest'
import { resolveTaskDetail } from '../../ui/src/pages/workspace/task-collab/task-detail-state.ts'
import type { TaskData } from '../../ui/src/stores/task.store.ts'

function task(input: Partial<TaskData>): TaskData {
  return {
    id: 'task-a',
    title: 'Task A',
    source: 'human',
    status: 'draft',
    stage: '',
    assigned_agent_id: null,
    created_at: '2026-07-21T00:00:00.000Z',
    completed_at: null,
    ...input,
  }
}

describe('task detail state', () => {
  test('waits for full detail instead of treating the preview as the task body', () => {
    const summary = task({ descriptionPreview: 'Task preview...' })
    expect(resolveTaskDetail(summary, undefined)).toBeNull()
  })

  test('keeps the full description while applying newer summary status', () => {
    const summary = task({ status: 'running', descriptionPreview: 'Task preview...' })
    const detail = task({ status: 'draft', description: 'Complete task body' })

    expect(resolveTaskDetail(summary, detail)).toMatchObject({
      status: 'running',
      description: 'Complete task body',
    })
  })
})
