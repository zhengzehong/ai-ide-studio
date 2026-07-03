import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentHubConnectionStore, type AgentHubConnectionRow } from '../../src/store/agent-hub-connections.js'
import { agentHubService } from '../../src/core/agent-hub/index.js'
import { hubClient } from '../../src/core/agent-hub/hub-client.js'
import { resetCachedMachineIdForTest } from '../../src/core/agent-hub/machine-id.js'
import { acpHost } from '../../src/acp/host.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-hub-connections-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  resetCachedMachineIdForTest()
  process.env.AGENT_HUB_ENABLED = 'true'
  process.env.AGENT_HUB_URL = 'http://hub.test'
  process.env.AGENT_HUB_PROVIDER_TOKEN = 'provider-token'
  process.env.AGENT_HUB_CALLER_TOKEN = 'caller-token'
  process.env.AGENT_HUB_INTERNAL_TOKEN = 'internal-token'
})

afterEach(() => {
  agentHubService._resetForTest()
  resetCachedMachineIdForTest()
  delete process.env.AGENT_HUB_ENABLED
  delete process.env.AGENT_HUB_URL
  delete process.env.AGENT_HUB_PROVIDER_TOKEN
  delete process.env.AGENT_HUB_CALLER_TOKEN
  delete process.env.AGENT_HUB_INTERNAL_TOKEN
  vi.useRealTimers()
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function makeRow(overrides: Partial<AgentHubConnectionRow> = {}): AgentHubConnectionRow {
  return {
    session_id: 'sess-1',
    agent_id: 'agent-1',
    project_id: null,
    registration_id: 'reg-1',
    hub_url: 'http://hub.test',
    hub_agent_id: 'h-me',
    machine_id: 'mac-aaaaaaaa',
    connected_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('agentHubConnectionStore CRUD', () => {
  test('upsert + list + delete', () => {
    expect(agentHubConnectionStore.list()).toEqual([])
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-1' }))
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-2', agent_id: 'agent-2' }))
    expect(agentHubConnectionStore.list()).toHaveLength(2)

    agentHubConnectionStore.delete('sess-1')
    expect(agentHubConnectionStore.list()).toHaveLength(1)
    expect(agentHubConnectionStore.list()[0].session_id).toBe('sess-2')
  })

  test('upsert 同 session_id 覆盖更新', () => {
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-1', agent_id: 'agent-1' }))
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-1', agent_id: 'agent-2' }))
    expect(agentHubConnectionStore.list()).toHaveLength(1)
    expect(agentHubConnectionStore.list()[0].agent_id).toBe('agent-2')
  })

  test('updateActivity 只改 last_activity_at,不改其他字段', () => {
    agentHubConnectionStore.upsert(makeRow({
      session_id: 'sess-1',
      agent_id: 'agent-1',
      last_activity_at: '2026-07-03T08:00:00.000Z',
    }))
    const before = agentHubConnectionStore.list()[0]
    const originalConnectedAt = before.connected_at

    agentHubConnectionStore.updateActivity('sess-1', '2026-07-03T12:00:00.000Z')
    const after = agentHubConnectionStore.list()[0]
    expect(after.last_activity_at).toBe('2026-07-03T12:00:00.000Z')
    expect(after.agent_id).toBe('agent-1')
    expect(after.connected_at).toBe(originalConnectedAt)
    expect(after.registration_id).toBe('reg-1')
  })

  test('listStale 只返回 last_activity_at < threshold 的', () => {
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-old', last_activity_at: '2026-07-03T00:00:00.000Z' }))
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-new', last_activity_at: '2026-07-03T23:00:00.000Z' }))

    const stale = agentHubConnectionStore.listStale('2026-07-03T12:00:00.000Z')
    expect(stale).toHaveLength(1)
    expect(stale[0].session_id).toBe('sess-old')
  })

  test('listStale threshold 等于 last_activity_at 时不返回(< 严格小于)', () => {
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-1', last_activity_at: '2026-07-03T12:00:00.000Z' }))
    const stale = agentHubConnectionStore.listStale('2026-07-03T12:00:00.000Z')
    expect(stale).toEqual([])
  })
})

describe('connect / disconnect 写持久化', () => {
  test('connect 成功后 upsert 到 DB', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([])

    await agentHubService.connect(session.id, agent.id, undefined)

    const row = agentHubConnectionStore.list()[0]
    expect(row.session_id).toBe(session.id)
    expect(row.agent_id).toBe(agent.id)
    expect(row.registration_id).toBe('reg-1')
    expect(row.hub_agent_id).toBe('h-me')
    expect(row.hub_url).toBe('http://hub.test')
    expect(row.machine_id).toMatch(/^mac-/)
    expect(row.connected_at).toBeTruthy()
    expect(row.last_activity_at).toBeTruthy()
  })

  test('disconnectBySession 成功后从 DB 删除', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)

    await agentHubService.connect(session.id, agent.id, undefined)
    expect(agentHubConnectionStore.list()).toHaveLength(1)

    await agentHubService.disconnectBySession(session.id)
    expect(agentHubConnectionStore.list()).toEqual([])
  })

  test('send 成功后 updateActivity', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([
      { hubAgentId: 'h-other', name: 'B' },
    ])
    vi.spyOn(hubClient, 'sendMessage').mockResolvedValue({
      task: { id: 'T1', status: { state: 'TASK_STATE_SUBMITTED' } },
    })

    await agentHubService.connect(session.id, agent.id, undefined)
    const beforeTs = agentHubConnectionStore.list()[0].last_activity_at

    // 确保时间戳变化
    await new Promise((r) => setTimeout(r, 10))
    await agentHubService.send(session.id, 'h-other', 'hi')

    const afterTs = agentHubConnectionStore.list()[0].last_activity_at
    expect(afterTs).not.toBe(beforeTs)
    expect(afterTs > beforeTs).toBe(true)
  })
})

describe('reconnectAll', () => {
  test('session 活跃 → 调 connect 重连', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    const registerSpy = vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([])

    agentHubConnectionStore.upsert(makeRow({
      session_id: session.id,
      agent_id: agent.id,
    }))

    await agentHubService.reconnectAll()

    expect(registerSpy).toHaveBeenCalledTimes(1)
    expect(agentHubService.isConnected(session.id)).toBe(true)
  })

  test('session 已关闭 → 调 hubClient.unregister + 删 DB', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    sessionStore.updateStatus(session.id, 'closed')

    const registerSpy = vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    const unregisterSpy = vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)

    agentHubConnectionStore.upsert(makeRow({
      session_id: session.id,
      agent_id: agent.id,
    }))

    await agentHubService.reconnectAll()

    expect(registerSpy).not.toHaveBeenCalled()
    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    expect(agentHubConnectionStore.list()).toEqual([])
  })

  test('session 已删除(deleted_at) → 调 unregister + 删 DB', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    // 模拟删除:直接 UPDATE deleted_at
    sessionStore.delete(session.id)

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    const unregisterSpy = vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)

    agentHubConnectionStore.upsert(makeRow({
      session_id: session.id,
      agent_id: agent.id,
    }))

    await agentHubService.reconnectAll()

    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    expect(agentHubConnectionStore.list()).toEqual([])
  })

  test('session 不存在 → 调 unregister + 删 DB', async () => {
    const unregisterSpy = vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)
    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: 'agent-1', hubAgentId: 'h-me' }],
      reused: false,
    })

    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-not-exist', agent_id: 'agent-1' }))

    await agentHubService.reconnectAll()

    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    expect(agentHubConnectionStore.list()).toEqual([])
  })

  test('connect 重连失败 → 保留 DB 记录等下次', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockRejectedValue({ message: 'Hub 不可达', status: 0 })

    agentHubConnectionStore.upsert(makeRow({
      session_id: session.id,
      agent_id: agent.id,
    }))

    await agentHubService.reconnectAll()

    // 失败时保留 DB 记录
    expect(agentHubConnectionStore.list()).toHaveLength(1)
    expect(agentHubService.isConnected(session.id)).toBe(false)
  })

  test('DB 为空时 no-op', async () => {
    const registerSpy = vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [],
      reused: false,
    })
    await agentHubService.reconnectAll()
    expect(registerSpy).not.toHaveBeenCalled()
  })
})

describe('cleanupStale', () => {
  test('12h 前的记录被删 + hubClient.unregister 被调', async () => {
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-old', last_activity_at: old }))
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-new', last_activity_at: new Date().toISOString() }))

    const unregisterSpy = vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)

    await agentHubService.cleanupStale()

    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    expect(unregisterSpy.mock.calls[0][2]).toBe('reg-1')
    const remaining = agentHubConnectionStore.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].session_id).toBe('sess-new')
  })

  test('内存 connections Map 中也有 stale 连接时一并清', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)

    await agentHubService.connect(session.id, agent.id, undefined)
    expect(agentHubService.isConnected(session.id)).toBe(true)

    // 把 last_activity_at 改成 13h 前
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
    agentHubConnectionStore.updateActivity(session.id, old)

    await agentHubService.cleanupStale()

    expect(agentHubService.isConnected(session.id)).toBe(false)
    expect(agentHubConnectionStore.list()).toEqual([])
  })

  test('没有 stale 记录时 no-op', async () => {
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-1', last_activity_at: new Date().toISOString() }))
    const unregisterSpy = vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)

    await agentHubService.cleanupStale()
    expect(unregisterSpy).not.toHaveBeenCalled()
    expect(agentHubConnectionStore.list()).toHaveLength(1)
  })

  test('unregister 抛错时仍然删 DB(继续)', async () => {
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
    agentHubConnectionStore.upsert(makeRow({ session_id: 'sess-old', last_activity_at: old }))
    vi.spyOn(hubClient, 'unregister').mockRejectedValue({ message: 'Hub 不可达' })

    await agentHubService.cleanupStale()
    expect(agentHubConnectionStore.list()).toEqual([])
  })
})

describe('startCleanupTimer', () => {
  test('每小时触发一次 cleanupStale', () => {
    vi.useFakeTimers()
    const cleanupSpy = vi.spyOn(agentHubService, 'cleanupStale').mockResolvedValue(undefined)

    const timer = agentHubService.startCleanupTimer()
    try {
      expect(cleanupSpy).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(cleanupSpy).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(cleanupSpy).toHaveBeenCalledTimes(2)
    } finally {
      clearInterval(timer)
    }
  })
})

describe('handleInboundTask 更新活动时间', () => {
  test('收到 inbound task 时 updateActivity', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    vi.spyOn(hubClient, 'sendMessage').mockResolvedValue({
      task: { id: 'T1', status: { state: 'TASK_STATE_SUBMITTED' } },
    })
    vi.spyOn(acpHost, 'prompt').mockResolvedValue(undefined as never)

    await agentHubService.connect(session.id, agent.id, undefined)
    // 把 last_activity_at 改成 5s 前,确保 updateActivity 能观测到差异
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString()
    agentHubConnectionStore.updateActivity(session.id, fiveSecondsAgo)
    const beforeTs = agentHubConnectionStore.list()[0].last_activity_at

    // 直接调 handleInboundTask 模拟 SSE 收到 inbound task
    const { handleInboundTask } = await import('../../src/core/agent-hub/task-relay.js')
    const conn = {
      sessionId: session.id,
      agentId: agent.id,
      projectId: null,
      hubUrl: 'http://hub.test',
      providerToken: 'provider-token',
      callerToken: 'caller-token',
      internalToken: 'internal-token',
      registrationId: 'reg-1',
      hubAgentId: 'h-me',
      machineId: 'mac-aaaaaaaa',
      sseClient: { stop: () => {} } as never,
      outboundTasks: new Map(),
      inboundTasks: new Map(),
      contextSessionMap: new Map(),
      doneListeners: new Map(),
      agentCache: new Map(),
    } as never
    await handleInboundTask(conn, {
      message: { messageId: 'm1', contextId: 'ctx-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      configuration: { taskPushNotificationConfig: { url: 'http://hub/push', authentication: { credentials: 'tok' } } },
      metadata: { hubTaskId: 'T-inbound', sourceHubAgentId: 'h-other' },
    })

    const afterTs = agentHubConnectionStore.list()[0].last_activity_at
    expect(afterTs > beforeTs).toBe(true)
  })
})
