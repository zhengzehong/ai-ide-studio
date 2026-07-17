import { beforeEach, describe, expect, test } from 'vitest'

const {
  emptyProjectViewState,
  readProjectViewState,
  useProjectViewStateStore,
} = await import('../../ui/src/stores/project-view-state.store.ts')

describe('project view state', () => {
  beforeEach(() => {
    useProjectViewStateStore.setState({ byProjectId: {} })
  })

  test('keeps workspace and task state isolated by project', () => {
    const store = useProjectViewStateStore.getState()
    store.patchWorkspace('a', { sidebarTab: 'files', selectedAgentId: 'agent-a' })
    store.patchTasks('a', { selectedTaskId: 'task-a', scrollLeft: 120 })
    store.patchWorkspace('b', { sidebarTab: 'sessions', selectedAgentId: 'agent-b' })

    expect(useProjectViewStateStore.getState().byProjectId.a).toMatchObject({
      workspace: { sidebarTab: 'files', selectedAgentId: 'agent-a' },
      tasks: { selectedTaskId: 'task-a', scrollLeft: 120 },
    })
    expect(useProjectViewStateStore.getState().byProjectId.b?.tasks).toBeUndefined()
  })

  test('patching one page preserves the other page state and clear removes only one project', () => {
    const store = useProjectViewStateStore.getState()
    store.patchTasks('a', { selectedTaskId: 'task-a' })
    store.patchWorkspace('a', { sidebarTab: 'files' })
    store.patchTasks('b', { selectedTaskId: 'task-b' })
    store.clearProject('a')

    expect(useProjectViewStateStore.getState().byProjectId.a).toBeUndefined()
    expect(useProjectViewStateStore.getState().byProjectId.b?.tasks?.selectedTaskId).toBe('task-b')
  })

  test('falls back to an empty state when persisted JSON is corrupted', () => {
    const storage = {
      getItem: () => '{broken',
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } satisfies Storage

    expect(readProjectViewState(storage)).toEqual(emptyProjectViewState())
  })
})
