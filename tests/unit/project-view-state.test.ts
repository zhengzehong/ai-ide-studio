import { beforeEach, describe, expect, test, vi } from 'vitest'

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

  test('persists workspace tag filter and archive toggle, excluding volatile fields', () => {
    const written: string[] = []
    const storage = {
      getItem: () => null,
      setItem: (_key: string, value: string) => {
        written.push(value)
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } satisfies Storage

    vi.stubGlobal('localStorage', storage)
    try {
      const store = useProjectViewStateStore.getState()
      store.patchWorkspace('a', {
        sessionTagFilter: ['调研', 'workbench'],
        showArchived: true,
        scrollTopByPanel: { 'panel-1': 120 },
      })
    } finally {
      vi.unstubAllGlobals()
    }

    expect(written).toHaveLength(1)
    const persisted = JSON.parse(written[0]) as { byProjectId: Record<string, { workspace?: Record<string, unknown> }> }
    // 精确断言：筛选与归档视图进入白名单，滚动位置不持久化。
    expect(persisted.byProjectId.a.workspace).toEqual({
      sessionTagFilter: ['调研', 'workbench'],
      showArchived: true,
    })
  })
})
