import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentHubService } from '../../src/core/agent-hub/index.js'
import { hubClient } from '../../src/core/agent-hub/hub-client.js'
import { resetCachedMachineIdForTest } from '../../src/core/agent-hub/machine-id.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'
import { getHandler } from '../../src/tools/handlers/index.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-hub-tools-'))
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
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('agent_hub.* MCP 工具', () => {
  test('未启用 Hub 时 connect 返回 disabled', async () => {
    delete process.env.AGENT_HUB_ENABLED
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const result = await executeJson('agent_hub.connect', {}, { sessionId: session.id, agentId: agent.id })
    expect(result.status).toBe('disabled')
  })

  test('connect 成功后返回 hubAgentId 和 discoveredAgents', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      transportMode: 'sse',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me', a2aBaseUrl: 'http://hub/a2a' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([
      { hubAgentId: 'h-other', name: 'B Agent', description: 'desc', scopeKeys: [], capabilityTags: [] },
      { hubAgentId: 'h-me', name: 'A', description: '', scopeKeys: [], capabilityTags: [] },
    ])
    const startSpy = vi.spyOn(agentHubService as never, 'disconnectBySession').mockResolvedValue(undefined)

    const result = await executeJson('agent_hub.connect', {}, { sessionId: session.id, agentId: agent.id })
    expect(result.status).toBe('connected')
    expect(result.hubAgentId).toBe('h-me')
    expect(result.registrationId).toBe('reg-1')
    expect(Array.isArray(result.discoveredAgents)).toBe(true)
    expect(result.discoveredAgents.map((a: { hubAgentId: string }) => a.hubAgentId)).toEqual(['h-other'])
    expect(startSpy).not.toHaveBeenCalled()
  })

  test('已连接时再次 connect 返回 already_connected', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    const searchSpy = vi.spyOn(hubClient, 'search').mockResolvedValue([])

    await executeJson('agent_hub.connect', {}, { sessionId: session.id, agentId: agent.id })
    const result = await executeJson('agent_hub.connect', {}, { sessionId: session.id, agentId: agent.id })
    expect(result.status).toBe('already_connected')
    expect(searchSpy).toHaveBeenCalledTimes(2)
  })

  test('disconnect 未连接时返回 not_connected', async () => {
    const session = sessionStore.create({ agentId: 'agent-x' })
    const result = await executeJson('agent_hub.disconnect', {}, { sessionId: session.id })
    expect(result.status).toBe('not_connected')
  })

  test('list 未连接时返回 isError', async () => {
    const session = sessionStore.create({ agentId: 'agent-x' })
    const handler = getHandler('agent_hub.list')!
    const result: ToolHandlerResult = await handler.execute({}, { sessionId: session.id })
    expect(result.isError).toBe(true)
  })

  test('list 已连接时返回 agents 列表(过滤掉自己)', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    const searchSpy = vi.spyOn(hubClient, 'search').mockResolvedValue([
      { hubAgentId: 'h-me', name: 'A' },
      { hubAgentId: 'h-other', name: 'B' },
      { hubAgentId: 'h-third', name: 'C' },
    ])

    await executeJson('agent_hub.connect', {}, { sessionId: session.id, agentId: agent.id })
    searchSpy.mockClear()

    const result = await executeJson('agent_hub.list', {}, { sessionId: session.id, agentId: agent.id })
    expect(result.status).toBe('ok')
    expect(result.agents.map((a: { hubAgentId: string }) => a.hubAgentId)).toEqual(['h-other', 'h-third'])
  })

  test('send 未连接时返回 isError', async () => {
    const session = sessionStore.create({ agentId: 'agent-x' })
    const handler = getHandler('agent_hub.send')!
    const result: ToolHandlerResult = await handler.execute(
      { targetHubAgentId: 'h-1', message: 'hi' },
      { sessionId: session.id },
    )
    expect(result.isError).toBe(true)
  })

  test('send 缺少 targetHubAgentId 抛错', async () => {
    const session = sessionStore.create({ agentId: 'agent-x' })
    const handler = getHandler('agent_hub.send')!
    await expect(
      handler.execute({ message: 'hi' }, { sessionId: session.id }),
    ).rejects.toThrow('targetHubAgentId')
  })

  test('send 已连接时调 hubClient.sendMessage 返回 hubTaskId', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([
      { hubAgentId: 'h-other', name: 'B Agent' },
    ])
    const sendSpy = vi.spyOn(hubClient, 'sendMessage').mockResolvedValue({
      task: { id: 'T1', status: { state: 'TASK_STATE_SUBMITTED' } },
    })

    await executeJson('agent_hub.connect', {}, { sessionId: session.id, agentId: agent.id })
    const result = await executeJson(
      'agent_hub.send',
      { targetHubAgentId: 'h-other', message: '帮我审合同' },
      { sessionId: session.id, agentId: agent.id },
    )
    expect(result.hubTaskId).toBe('T1')
    expect(result.status).toBe('TASK_STATE_SUBMITTED')
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const call = sendSpy.mock.calls[0]
    expect(call[1]).toBe('caller-token')
    expect(call[2]).toBe('h-other')
    const body = call[3] as { metadata: { callerHubAgentId: string; callerTransportMode: string } }
    expect(body.metadata.callerHubAgentId).toBe('h-me')
    expect(body.metadata.callerTransportMode).toBe('sse')
  })

  test('工具已注册到 handler map', () => {
    expect(getHandler('agent_hub.connect')).toBeDefined()
    expect(getHandler('agent_hub.disconnect')).toBeDefined()
    expect(getHandler('agent_hub.list')).toBeDefined()
    expect(getHandler('agent_hub.send')).toBeDefined()
  })
})

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  const result: ToolHandlerResult = await handler.execute(input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}
