import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ALL_PROJECTS_SCOPE, emptyProjectCache } from '../../ui/src/stores/project-cache.ts'

const wsMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(msg: Record<string, unknown>) => void>>()
  return {
    handlers,
    request: vi.fn(async () => [] as unknown[]),
    on: vi.fn((event: string, handler: (msg: Record<string, unknown>) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)?.add(handler)
      return () => handlers.get(event)?.delete(handler)
    }),
  }
})

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { useTaskStore } = await import('../../ui/src/stores/task.store.ts')
type TaskData = import('../../ui/src/stores/task.store.ts').TaskData

function task(id: string, projectId: string, title = id): TaskData {
  return {
    id,
    title,
    description: null,
    source: 'human',
    status: 'draft',
    stage: '',
    assigned_agent_id: null,
    created_at: '2026-07-17T00:00:00.000Z',
    completed_at: null,
    project_id: projectId,
  }
}

function emit(event: string, message: Record<string, unknown>): void {
  for (const handler of wsMock.handlers.get(event) ?? []) handler(message)
}

describe('task project cache', () => {
  beforeEach(() => {
    wsMock.handlers.clear()
    wsMock.request.mockReset()
    useTaskStore.setState({
      tasks: [],
      modes: [],
      loading: false,
      refreshing: false,
      activeScope: ALL_PROJECTS_SCOPE,
      taskCache: emptyProjectCache<TaskData[]>(),
      modeCache: emptyProjectCache(),
    })
  })

  test('restores a cached project synchronously without clearing its list', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'tasks.list') return []
      return msg.projectId === 'a' ? [task('task-a', 'a')] : [task('task-b', 'b')]
    })

    useTaskStore.getState().activateProject('a')
    await useTaskStore.getState().fetchTasks('a', { force: true })
    useTaskStore.getState().activateProject('b')
    await useTaskStore.getState().fetchTasks('b', { force: true })
    useTaskStore.getState().activateProject('a')

    expect(useTaskStore.getState().tasks.map((item) => item.id)).toEqual(['task-a'])
    expect(useTaskStore.getState().loading).toBe(false)
  })

  test('updates a background project cache without changing the active list', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'tasks.list') return []
      return msg.projectId === 'a' ? [task('task-a', 'a')] : [task('task-b', 'b')]
    })
    useTaskStore.getState().activateProject('a')
    await useTaskStore.getState().fetchTasks('a', { force: true })
    useTaskStore.getState().activateProject('b')
    await useTaskStore.getState().fetchTasks('b', { force: true })
    useTaskStore.getState().activateProject('a')
    const off = useTaskStore.getState().setupListeners()

    emit('task:update', { taskId: 'task-b-new', data: task('task-b-new', 'b', 'Background') })

    expect(useTaskStore.getState().tasks.map((item) => item.id)).toEqual(['task-a'])
    expect(useTaskStore.getState().taskCache.entries.b?.data.map((item) => item.id))
      .toEqual(['task-b-new', 'task-b'])
    off()
  })
})
