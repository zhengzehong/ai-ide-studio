import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  clearGlobalModelProfile,
  getGlobalModelProfile,
  readAgentModelProfileMode,
  setGlobalModelProfile,
} from '../../src/acp/runtime-global-model-profile.js'
import { createCustomProjectAgent, setAgentsModelProfileMode } from '../../src/core/agents.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-global-model-profile-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('runtime global model profile', () => {
  test('stores and clears an independent global profile per runtime', () => {
    expect(getGlobalModelProfile('codex')).toEqual({ enabled: false })

    setGlobalModelProfile('codex', 'mpf-codex')

    expect(getGlobalModelProfile('codex')).toEqual({ enabled: true, profileId: 'mpf-codex' })
    expect(getGlobalModelProfile('claude')).toEqual({ enabled: false })

    clearGlobalModelProfile('codex')
    expect(getGlobalModelProfile('codex')).toEqual({ enabled: false })
  })

  test('treats legacy bindings as fixed and unbound Agents as global candidates', () => {
    expect(readAgentModelProfileMode(null)).toBe('global')
    expect(readAgentModelProfileMode(JSON.stringify({ modelProfileId: 'mpf-fixed' }))).toBe('fixed')
    expect(readAgentModelProfileMode(JSON.stringify({ modelProfileMode: 'system', modelProfileId: 'mpf-old' }))).toBe('system')
  })

  test('bulk updates Agent policy without changing existing profile references', () => {
    const first = agentStore.create({ name: 'Codex A', type: 'dev', runtime: 'codex', config: { modelProfileId: 'mpf-a' } })
    const second = agentStore.create({ name: 'Codex B', type: 'dev', runtime: 'codex' })
    agentStore.create({ name: 'Claude', type: 'dev', runtime: 'claude' })

    expect(setAgentsModelProfileMode('codex', 'global')).toBe(2)
    expect(JSON.parse(agentStore.get(first.id)?.config_json ?? '{}')).toMatchObject({ modelProfileId: 'mpf-a', modelProfileMode: 'global' })
    expect(JSON.parse(agentStore.get(second.id)?.config_json ?? '{}')).toMatchObject({ modelProfileMode: 'global' })
  })

  test('rejects a fixed policy without a selected profile', () => {
    const project = projectStore.create({ name: 'Project', workDir: tmp })

    expect(() => createCustomProjectAgent({
      projectId: project.id,
      name: 'Invalid fixed Agent',
      type: 'dev',
      runtime: 'codex',
      modelProfileMode: 'fixed',
    })).toThrow('固定模型档案策略必须选择模型档案')
  })
})
