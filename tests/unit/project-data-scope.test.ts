import { beforeEach, describe, expect, test, vi } from 'vitest'

const stores = vi.hoisted(() => ({
  task: {
    activateProject: vi.fn(),
    fetchTasks: vi.fn(async () => undefined),
    fetchModes: vi.fn(async () => []),
    invalidateProject: vi.fn(),
    clearProjectCache: vi.fn(),
  },
  agent: {
    activateProject: vi.fn(),
    fetchAgents: vi.fn(async () => undefined),
    invalidateProject: vi.fn(),
    clearProjectCache: vi.fn(),
  },
  session: {
    activateProject: vi.fn(),
    fetchSessions: vi.fn(async () => undefined),
    invalidateProject: vi.fn(),
    clearProjectCache: vi.fn(),
  },
  filesystem: {
    activateProject: vi.fn(), fetchTree: vi.fn(async () => undefined),
    invalidateProject: vi.fn(), clearProjectCache: vi.fn(),
  },
  knowledge: {
    activateProject: vi.fn(), fetchKnowledgeBases: vi.fn(async () => undefined),
    invalidateProject: vi.fn(), clearProjectCache: vi.fn(),
  },
  rules: {
    activateProject: vi.fn(), fetchRules: vi.fn(async () => undefined),
    invalidateProject: vi.fn(), clearProjectCache: vi.fn(),
  },
  events: {
    activateProject: vi.fn(), fetchCategories: vi.fn(async () => undefined),
    fetchEvents: vi.fn(async () => undefined), fetchSubscriptions: vi.fn(async () => undefined),
    invalidateProject: vi.fn(), clearProjectCache: vi.fn(),
  },
  memory: {
    activateScope: vi.fn(), invalidateProject: vi.fn(), clearProjectCache: vi.fn(),
  },
  view: {
    clearProject: vi.fn(), reconcileProjects: vi.fn(),
  },
  clearLastSession: vi.fn(),
}))

vi.mock('../../ui/src/stores/task.store', () => ({
  useTaskStore: { getState: () => stores.task },
}))
vi.mock('../../ui/src/stores/agent.store', () => ({
  useAgentStore: { getState: () => stores.agent },
}))
vi.mock('../../ui/src/stores/session.store', () => ({
  useSessionStore: { getState: () => stores.session },
  clearProjectLastSession: stores.clearLastSession,
}))
vi.mock('../../ui/src/stores/filesystem.store', () => ({
  useFileSystemStore: { getState: () => stores.filesystem },
}))
vi.mock('../../ui/src/stores/knowledge-base.store', () => ({
  useKnowledgeBaseStore: { getState: () => stores.knowledge },
}))
vi.mock('../../ui/src/stores/rule.store', () => ({
  useRuleStore: { getState: () => stores.rules },
}))
vi.mock('../../ui/src/stores/event-center.store', () => ({
  useEventCenterStore: { getState: () => stores.events },
}))
vi.mock('../../ui/src/stores/agent-memory.store', () => ({
  useAgentMemoryStore: { getState: () => stores.memory },
}))
vi.mock('../../ui/src/stores/project-view-state.store', () => ({
  useProjectViewStateStore: { getState: () => stores.view },
}))

const {
  activateProjectData,
  clearProjectData,
  invalidateProjectData,
  reconcileProjectData,
} = await import('../../ui/src/project-scope/project-data-scope.ts')

describe('project data scope', () => {
  beforeEach(() => vi.clearAllMocks())

  test('activates cached lists before starting background refreshes', async () => {
    const activationOrder: string[] = []
    stores.task.activateProject.mockImplementation(() => activationOrder.push('task'))
    stores.agent.activateProject.mockImplementation(() => activationOrder.push('agent'))
    stores.session.activateProject.mockImplementation(() => activationOrder.push('session'))

    const refresh = activateProjectData('project-a')

    expect(activationOrder).toEqual(['task', 'agent', 'session'])
    await refresh
    expect(stores.task.fetchTasks).toHaveBeenCalledWith('project-a')
    expect(stores.task.fetchModes).toHaveBeenCalledWith('project-a')
    expect(stores.agent.fetchAgents).toHaveBeenCalledWith('project-a')
    expect(stores.session.fetchSessions).toHaveBeenCalledWith(undefined, 'project-a')
    expect(stores.filesystem.activateProject).toHaveBeenCalledWith('project-a')
    expect(stores.knowledge.activateProject).toHaveBeenCalledWith('project-a')
    expect(stores.rules.activateProject).toHaveBeenCalledWith('project-a')
    expect(stores.events.activateProject).toHaveBeenCalledWith('project-a')
    expect(stores.memory.activateScope).toHaveBeenCalledWith('project-a')
  })

  test('reactivates project stores while coalescing concurrent refreshes', async () => {
    const first = activateProjectData('project-concurrent')
    const second = activateProjectData('project-concurrent')

    await Promise.all([first, second])

    expect(stores.task.activateProject).toHaveBeenCalledTimes(2)
    expect(stores.agent.activateProject).toHaveBeenCalledTimes(2)
    expect(stores.session.activateProject).toHaveBeenCalledTimes(2)
    expect(stores.task.fetchTasks).toHaveBeenCalledTimes(1)
    expect(stores.task.fetchModes).toHaveBeenCalledTimes(1)
    expect(stores.agent.fetchAgents).toHaveBeenCalledTimes(1)
    expect(stores.session.fetchSessions).toHaveBeenCalledTimes(2)
    expect(stores.filesystem.fetchTree).toHaveBeenCalledTimes(1)
    expect(stores.knowledge.fetchKnowledgeBases).toHaveBeenCalledTimes(1)
    expect(stores.rules.fetchRules).toHaveBeenCalledTimes(1)
    expect(stores.events.fetchCategories).toHaveBeenCalledTimes(1)
    expect(stores.events.fetchEvents).toHaveBeenCalledTimes(1)
    expect(stores.events.fetchSubscriptions).toHaveBeenCalledTimes(1)
  })

  test('rechecks sessions when a project is reactivated during a coalesced refresh', async () => {
    let finishTasks: (() => void) | undefined
    stores.task.fetchTasks.mockImplementation(() => new Promise<void>((resolve) => {
      finishTasks = resolve
    }))

    const first = activateProjectData('project-a')
    await vi.waitFor(() => expect(stores.session.fetchSessions).toHaveBeenCalledTimes(1))
    const second = activateProjectData('project-a')

    expect(stores.session.fetchSessions).toHaveBeenCalledTimes(2)

    finishTasks?.()
    await Promise.all([first, second])
  })

  test('reactivates a project when returning before its refresh completes', async () => {
    let completeProjectA: (() => void) | undefined
    stores.task.fetchTasks.mockImplementation((projectId: string) => {
      if (projectId !== 'project-a') return Promise.resolve(undefined)
      return new Promise<void>((resolve) => {
        completeProjectA = resolve
      })
    })

    const projectARefresh = activateProjectData('project-a')
    await activateProjectData('project-b')
    const returningToProjectA = activateProjectData('project-a')

    expect(stores.task.activateProject).toHaveBeenLastCalledWith('project-a')
    expect(stores.agent.activateProject).toHaveBeenLastCalledWith('project-a')
    expect(stores.session.activateProject).toHaveBeenLastCalledWith('project-a')
    expect(stores.task.fetchTasks).toHaveBeenCalledTimes(2)

    completeProjectA?.()
    await Promise.all([projectARefresh, returningToProjectA])
  })

  test('fans invalidation and cleanup out to all MVP stores', () => {
    invalidateProjectData('project-a')
    clearProjectData('project-a')

    expect(stores.task.invalidateProject).toHaveBeenCalledWith('project-a')
    expect(stores.agent.invalidateProject).toHaveBeenCalledWith('project-a')
    expect(stores.session.invalidateProject).toHaveBeenCalledWith('project-a')
    expect(stores.task.clearProjectCache).toHaveBeenCalledWith('project-a')
    expect(stores.agent.clearProjectCache).toHaveBeenCalledWith('project-a')
    expect(stores.session.clearProjectCache).toHaveBeenCalledWith('project-a')
    expect(stores.filesystem.clearProjectCache).toHaveBeenCalledWith('project-a')
    expect(stores.knowledge.clearProjectCache).toHaveBeenCalledWith('project-a')
    expect(stores.rules.clearProjectCache).toHaveBeenCalledWith('project-a')
    expect(stores.events.clearProjectCache).toHaveBeenCalledWith('project-a')
    expect(stores.memory.clearProjectCache).toHaveBeenCalledWith('project-a')
    expect(stores.view.clearProject).toHaveBeenCalledWith('project-a')
    expect(stores.clearLastSession).toHaveBeenCalledWith('project-a')
  })

  test('reconciles persisted view state against the valid project list', () => {
    reconcileProjectData(['project-b'])
    expect(stores.view.reconcileProjects).toHaveBeenCalledWith(['project-b'])
  })
})
