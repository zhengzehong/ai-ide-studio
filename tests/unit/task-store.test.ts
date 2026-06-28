import { describe, expect, test } from 'vitest'
import { mergeTaskById, type TaskData } from '../../ui/src/stores/task.store.ts'

function task(id: string, fields: Partial<TaskData> = {}): TaskData {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    source: 'human',
    status: 'backlog',
    stage: '待处理',
    assigned_agent_id: null,
    created_at: '2026-06-08T00:00:00.000Z',
    completed_at: null,
    ...fields,
  }
}

describe('task store merging', () => {
  test('merges a create response into an existing realtime-created task instead of duplicating it', () => {
    const realtimeTask = task('task-1', { title: '来自广播', stage: '已创建' })
    const responseTask = task('task-1', { title: '来自响应', sessionId: 'sess-1' })

    const merged = mergeTaskById([realtimeTask], responseTask)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: 'task-1',
      title: '来自响应',
      stage: '待处理',
      sessionId: 'sess-1',
    })
  })
})
