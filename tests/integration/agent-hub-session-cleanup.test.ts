import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentHubService } from '../../src/core/agent-hub/index.js'
import { hubClient } from '../../src/core/agent-hub/hub-client.js'
import { resetCachedMachineIdForTest } from '../../src/core/agent-hub/machine-id.js'
import { acpHost } from '../../src/acp/host.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-hub-session-cleanup-'))
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

describe('session 关闭自动 disconnect Hub', () => {
  test('closeSession 调 disconnectBySession + acpHost.closeSession', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    const unregisterSpy = vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)
    const acpCloseSpy = vi.spyOn(acpHost, 'closeSession').mockResolvedValue(undefined)

    await agentHubService.connect(session.id, agent.id, undefined)
    expect(agentHubService.isConnected(session.id)).toBe(true)

    await sessionManager.closeSession(session.id)
    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    expect(acpCloseSpy).toHaveBeenCalledTimes(1)
    expect(agentHubService.isConnected(session.id)).toBe(false)
  })

  test('archiveSession 调 disconnectBySession', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    const unregisterSpy = vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)

    await agentHubService.connect(session.id, agent.id, undefined)
    sessionManager.archiveSession(session.id)
    await new Promise((r) => setImmediate(r))
    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    expect(agentHubService.isConnected(session.id)).toBe(false)
  })

  test('deleteSession 调 disconnectBySession', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    vi.spyOn(hubClient, 'register').mockResolvedValue({
      registrationId: 'reg-1',
      agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
      reused: false,
    })
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    const unregisterSpy = vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)
    vi.spyOn(acpHost, 'closeSession').mockResolvedValue(undefined)

    await agentHubService.connect(session.id, agent.id, undefined)
    await sessionManager.deleteSession(session.id)
    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    expect(agentHubService.isConnected(session.id)).toBe(false)
  })

  test('closeSession 未连接 Hub 时也不报错(不调 unregister)', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    vi.spyOn(acpHost, 'closeSession').mockResolvedValue(undefined)
    const unregisterSpy = vi.spyOn(hubClient, 'unregister').mockResolvedValue(undefined)

    await sessionManager.closeSession(session.id)
    expect(unregisterSpy).not.toHaveBeenCalled()
  })
})
