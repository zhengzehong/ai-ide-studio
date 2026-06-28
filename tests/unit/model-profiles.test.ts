import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { updateProjectAgent } from '../../src/core/agents.js'
import { agentStore } from '../../src/store/agents.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'
import { projectStore } from '../../src/store/projects.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-model-profiles-'))
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

describe('model profiles', () => {
  test('stores Claude model mappings with model context', () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })

    const profile = modelProfileStore.create({
      name: 'Claude 编程档案',
      runtime: 'claude',
      providerId: provider.id,
      contextWindow: 200000,
      config: {
        defaultModel: 'deepseek-v4-pro[1m]',
        haikuModel: 'deepseek-v4-flash',
        sonnetModel: 'deepseek-v4-pro[1m]',
        opusModel: 'deepseek-v4-pro[1m]',
      },
    })

    expect(profile.id).toMatch(/^mpf-/)
    expect(profile.runtime).toBe('claude')
    expect(profile.context_window).toBe(200000)
    expect(JSON.parse(profile.config_json)).toEqual({
      defaultModel: 'deepseek-v4-pro[1m]',
      haikuModel: 'deepseek-v4-flash',
      sonnetModel: 'deepseek-v4-pro[1m]',
      opusModel: 'deepseek-v4-pro[1m]',
    })
    expect(modelProfileStore.list({ runtime: 'claude' }).map(p => p.id)).toEqual([profile.id])
  })

  test('updates Codex profile defaults and preserves positive model context', () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'Codex 轻量档案',
      runtime: 'codex',
      providerId: provider.id,
      contextWindow: 128000,
      config: { model: 'deepseek-v4-flash', effort: 'low' },
    })

    const updated = modelProfileStore.update(profile.id, {
      name: 'Codex 主力档案',
      contextWindow: 256000,
      config: { model: 'deepseek-v4-pro', effort: 'medium' },
    })

    expect(updated?.name).toBe('Codex 主力档案')
    expect(updated?.context_window).toBe(256000)
    expect(JSON.parse(updated?.config_json ?? '{}')).toEqual({ model: 'deepseek-v4-pro', effort: 'medium' })
  })

  test('keeps one default profile per runtime and clears default when disabled', () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })
    const light = modelProfileStore.create({
      name: 'Codex light',
      runtime: 'codex',
      providerId: provider.id,
      config: { model: 'deepseek-v4-flash', effort: 'low' },
      isDefault: true,
    })
    const pro = modelProfileStore.create({
      name: 'Codex pro',
      runtime: 'codex',
      providerId: provider.id,
      config: { model: 'deepseek-v4-pro', effort: 'medium' },
      isDefault: true,
    })

    expect(modelProfileStore.get(light.id)?.is_default).toBe(0)
    expect(modelProfileStore.get(pro.id)?.is_default).toBe(1)

    modelProfileStore.setDefault(light.id)

    expect(modelProfileStore.get(light.id)?.is_default).toBe(1)
    expect(modelProfileStore.get(pro.id)?.is_default).toBe(0)

    modelProfileStore.toggle(light.id, false)

    expect(modelProfileStore.get(light.id)?.enabled).toBe(0)
    expect(modelProfileStore.get(light.id)?.is_default).toBe(0)
  })

  test('binds a model profile to an Agent without removing existing config', () => {
    const agent = agentStore.create({
      name: '工程师',
      type: 'dev',
      runtime: 'codex',
      config: { templateId: 'tpl-dev', skills: ['code'] },
    })

    const updated = agentStore.update(agent.id, {
      config: { templateId: 'tpl-dev', skills: ['code'], modelProfileId: 'mpf-codex' },
    })

    expect(JSON.parse(updated?.config_json ?? '{}')).toEqual({
      templateId: 'tpl-dev',
      skills: ['code'],
      modelProfileId: 'mpf-codex',
    })
  })

  test('clears mismatched model profile when Agent runtime changes', () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'Codex light',
      runtime: 'codex',
      providerId: provider.id,
      contextWindow: 128000,
      config: { model: 'deepseek-v4-flash', effort: 'low' },
    })
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({
      name: 'Agent',
      type: 'dev',
      runtime: 'codex',
      projectId: project.id,
      config: { templateId: 'tpl-dev', modelProfileId: profile.id },
    })

    const updated = updateProjectAgent(agent.id, { runtime: 'claude' })

    expect(JSON.parse(updated.config_json ?? '{}')).toEqual({ templateId: 'tpl-dev' })
  })

  test('clears Agent bindings when a model profile is deleted', () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'Codex light',
      runtime: 'codex',
      providerId: provider.id,
      contextWindow: 128000,
      config: { model: 'deepseek-v4-flash', effort: 'low' },
    })
    const agent = agentStore.create({
      name: 'Agent',
      type: 'dev',
      runtime: 'codex',
      config: { templateId: 'tpl-dev', modelProfileId: profile.id },
    })

    modelProfileStore.delete(profile.id)

    const updated = agentStore.get(agent.id)
    expect(JSON.parse(updated?.config_json ?? '{}')).toEqual({ templateId: 'tpl-dev' })
  })

  test('clears Agent bindings when a profile runtime no longer matches', () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'Codex light',
      runtime: 'codex',
      providerId: provider.id,
      contextWindow: 128000,
      config: { model: 'deepseek-v4-flash', effort: 'low' },
    })
    const agent = agentStore.create({
      name: 'Agent',
      type: 'dev',
      runtime: 'codex',
      config: { templateId: 'tpl-dev', modelProfileId: profile.id },
    })

    modelProfileStore.update(profile.id, {
      runtime: 'claude',
      config: { defaultModel: 'deepseek-v4-pro[1m]' },
    })

    const updated = agentStore.get(agent.id)
    expect(JSON.parse(updated?.config_json ?? '{}')).toEqual({ templateId: 'tpl-dev' })
  })
})
