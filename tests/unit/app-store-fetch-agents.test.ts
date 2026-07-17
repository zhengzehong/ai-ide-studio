import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from '../../mobile/src/stores/app.store'
import { wsClient } from '@desktop/services/ws-client'

// Mock wsClient.request 捕获 agents.list 的 payload
vi.mock('@desktop/services/ws-client', () => ({
  wsClient: {
    request: vi.fn(),
    on: vi.fn(() => () => {}),
  },
}))

describe('app.store fetchAgents — 按 projectId 过滤', () => {
  beforeEach(() => {
    vi.mocked(wsClient.request).mockReset()
    useAppStore.setState({ agents: [] })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fetchAgents("p1") 发 { type: "agents.list", projectId: "p1" }', async () => {
    const fakeAgents = [
      { id: 'agent-a', name: 'Coder', type: 'coder', model: 'gpt' },
    ]
    vi.mocked(wsClient.request).mockResolvedValueOnce(fakeAgents)

    await useAppStore.getState().fetchAgents('p1')

    expect(wsClient.request).toHaveBeenCalledTimes(1)
    expect(wsClient.request).toHaveBeenCalledWith({
      type: 'agents.list',
      projectId: 'p1',
    })
    expect(useAppStore.getState().agents).toEqual(fakeAgents)
  })

  it('fetchAgents() 无参 → 发 { type: "agents.list" } 且 projectId 为 undefined(兜底拉全局)', async () => {
    const fakeAgents = [
      { id: 'agent-x', name: 'Global', type: 'coder', model: 'gpt' },
    ]
    vi.mocked(wsClient.request).mockResolvedValueOnce(fakeAgents)

    await useAppStore.getState().fetchAgents()

    expect(wsClient.request).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(wsClient.request).mock.calls[0][0] as Record<string, unknown>
    expect(payload.type).toBe('agents.list')
    // 无参时 projectId 应为 undefined(JSON.stringify 会剥掉,后端 list(undefined) 返回全局)
    expect(payload.projectId).toBeUndefined()
    expect(useAppStore.getState().agents).toEqual(fakeAgents)
  })

  it('fetchAgents(undefined) 与无参等价', async () => {
    vi.mocked(wsClient.request).mockResolvedValueOnce([])
    await useAppStore.getState().fetchAgents(undefined)
    const payload = vi.mocked(wsClient.request).mock.calls[0][0] as Record<string, unknown>
    expect(payload.type).toBe('agents.list')
    expect(payload.projectId).toBeUndefined()
  })

  it('切项目时 fetchAgents 重拉覆盖旧数据', async () => {
    // 第一次:p1 有 1 个 agent
    vi.mocked(wsClient.request).mockResolvedValueOnce([
      { id: 'agent-a', name: 'A', type: 'coder', model: 'gpt' },
    ])
    await useAppStore.getState().fetchAgents('p1')
    expect(useAppStore.getState().agents).toHaveLength(1)

    // 第二次:p2 有 2 个 agent
    vi.mocked(wsClient.request).mockResolvedValueOnce([
      { id: 'agent-b', name: 'B', type: 'coder', model: 'gpt' },
      { id: 'agent-c', name: 'C', type: 'coder', model: 'gpt' },
    ])
    await useAppStore.getState().fetchAgents('p2')
    expect(useAppStore.getState().agents).toHaveLength(2)
    expect(useAppStore.getState().agents.map((a) => a.id)).toEqual(['agent-b', 'agent-c'])
  })

  it('wsClient.request 抛错时不崩溃,agents 保持空数组', async () => {
    vi.mocked(wsClient.request).mockRejectedValueOnce(new Error('network down'))
    await useAppStore.getState().fetchAgents('p1')
    expect(useAppStore.getState().agents).toEqual([])
  })
})
