import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { acpHost } from '../../src/acp/host.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-mock-cap-'))
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(async () => {
  for (const agentId of acpHost.listRunning()) await acpHost.stopAgent(agentId)
  await new Promise((resolve) => setTimeout(resolve, 100))
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('mock agent capabilities', () => {
  test('exposes local test models and modes that can be switched', async () => {
    const agent = agentStore.create({ name: 'Mock 能力测试', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    await acpHost.ensureSession(agent.id, session.id)

    const initial = acpHost.getSessionCapabilities(agent.id, session.id)
    expect(initial?.models?.map((model) => model.modelId)).toEqual(['mock-fast', 'mock-smart'])
    expect(initial?.currentModelId).toBe('mock-fast')
    expect(initial?.modes?.map((mode) => mode.modeId)).toEqual(['default', 'plan'])
    expect(initial?.currentModeId).toBe('default')

    await acpHost.setModel(agent.id, session.id, 'mock-smart')
    await acpHost.setMode(agent.id, session.id, 'plan')

    const updated = acpHost.getSessionCapabilities(agent.id, session.id)
    expect(updated?.currentModelId).toBe('mock-smart')
    expect(updated?.currentModeId).toBe('plan')
  }, 10_000)
})
