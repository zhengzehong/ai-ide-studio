import { beforeEach, describe, expect, test, vi } from 'vitest'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => ({})),
  on: vi.fn(() => () => undefined),
}))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { useTaskStore } = await import('../../ui/src/stores/task.store.ts')

describe('task detail store', () => {
  beforeEach(() => {
    wsMock.request.mockReset()
    useTaskStore.setState({
      taskDetailsById: {},
      taskDetailLoadingById: {},
      taskDetailErrorById: {},
    })
  })

  test('loads and caches the complete task only when detail is requested', async () => {
    wsMock.request.mockResolvedValue({
      id: 'task-a',
      title: 'Task A',
      description: 'Complete task body',
      source: 'human',
      status: 'draft',
      stage: '',
      assigned_agent_id: null,
      created_at: '2026-07-21T00:00:00.000Z',
      completed_at: null,
      steps: [],
      stepProgress: { done: 0, total: 0 },
    })

    const detail = await useTaskStore.getState().fetchTaskDetail('task-a')

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'tasks.get', taskId: 'task-a' })
    expect(detail.description).toBe('Complete task body')
    expect(useTaskStore.getState().taskDetailsById['task-a']?.description)
      .toBe('Complete task body')
    expect(useTaskStore.getState().taskDetailLoadingById['task-a']).toBeUndefined()
    expect(useTaskStore.getState().taskDetailErrorById['task-a']).toBeUndefined()
  })

  test('keeps a retryable task detail error', async () => {
    wsMock.request.mockRejectedValue(new Error('Task detail unavailable'))

    await expect(useTaskStore.getState().fetchTaskDetail('task-a')).rejects
      .toThrow('Task detail unavailable')

    expect(useTaskStore.getState().taskDetailLoadingById['task-a']).toBeUndefined()
    expect(useTaskStore.getState().taskDetailErrorById['task-a'])
      .toBe('Task detail unavailable')
  })
})
