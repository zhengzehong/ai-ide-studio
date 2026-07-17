import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ALL_PROJECTS_SCOPE, emptyProjectCache } from '../../ui/src/stores/project-cache.ts'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => [] as unknown[]),
  on: vi.fn(() => () => undefined),
}))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { useAgentStore } = await import('../../ui/src/stores/agent.store.ts')
type AgentData = import('../../ui/src/stores/agent.store.ts').AgentData

function agent(id: string, projectId: string): AgentData {
  return {
    id,
    type: 'coder',
    name: id,
    runtime: 'codex',
    status: 'idle',
    permission_level: 0,
    config_json: null,
    created_at: '2026-07-17T00:00:00.000Z',
    project_id: projectId,
  }
}

describe('agent project cache', () => {
  beforeEach(() => {
    wsMock.request.mockReset()
    useAgentStore.setState({
      agents: [],
      loading: false,
      refreshing: false,
      activeScope: ALL_PROJECTS_SCOPE,
      agentCache: emptyProjectCache<AgentData[]>(),
    })
  })

  test('keeps agent lists isolated and restores the selected project cache', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'agents.list') return []
      return msg.projectId === 'a' ? [agent('agent-a', 'a')] : [agent('agent-b', 'b')]
    })

    useAgentStore.getState().activateProject('a')
    await useAgentStore.getState().fetchAgents('a', { force: true })
    useAgentStore.getState().activateProject('b')
    await useAgentStore.getState().fetchAgents('b', { force: true })
    useAgentStore.getState().activateProject('a')

    expect(useAgentStore.getState().agents.map((item) => item.id)).toEqual(['agent-a'])
    expect(useAgentStore.getState().agentCache.entries.b?.data.map((item) => item.id)).toEqual(['agent-b'])
  })
})
