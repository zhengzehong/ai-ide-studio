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
}))

vi.mock('../../ui/src/stores/task.store', () => ({
  useTaskStore: { getState: () => stores.task },
}))
vi.mock('../../ui/src/stores/agent.store', () => ({
  useAgentStore: { getState: () => stores.agent },
}))
vi.mock('../../ui/src/stores/session.store', () => ({
  useSessionStore: { getState: () => stores.session },
}))

const {
  activateProjectData,
  clearProjectData,
  invalidateProjectData,
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
  })
})
