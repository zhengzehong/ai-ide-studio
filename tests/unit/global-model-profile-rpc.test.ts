import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { getGlobalModelProfile } from '../../src/acp/runtime-global-model-profile.js'
import { modelRpcHandlers } from '../../src/gateway/rpc/models.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-global-model-profile-rpc-'))
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

describe('global model profile RPC', () => {
  test('sets and reads an enabled profile for the matching Runtime', () => {
    const { profile } = createProfile('codex')

    const setResult = callRpc('modelProfiles.global.set', { runtime: 'codex', profileId: profile.id })
    const getResult = callRpc('modelProfiles.global.get', { runtime: 'codex' })

    expect(setResult).toMatchObject({ runtime: 'codex', enabled: true, profileId: profile.id })
    expect(getResult).toMatchObject({ runtime: 'codex', enabled: true, profileId: profile.id })
  })

  test('rejects a profile from the other Runtime', () => {
    const { profile } = createProfile('claude')

    expect(() => callRpc('modelProfiles.global.set', {
      runtime: 'codex',
      profileId: profile.id,
    })).toThrow('模型档案 Runtime 不匹配')
  })

  test('rejects a profile whose Provider is disabled', () => {
    const { provider, profile } = createProfile('codex')
    modelProviderStore.toggle(provider.id, false)

    expect(() => callRpc('modelProfiles.global.set', {
      runtime: 'codex',
      profileId: profile.id,
    })).toThrow('模型档案对应的供应商不存在或已禁用')
  })

  test('self-heals a global binding after its profile is disabled', () => {
    const { profile } = createProfile('codex')
    callRpc('modelProfiles.global.set', { runtime: 'codex', profileId: profile.id })
    modelProfileStore.toggle(profile.id, false)

    expect(callRpc('modelProfiles.global.get', { runtime: 'codex' })).toEqual({
      runtime: 'codex',
      enabled: false,
      profileId: null,
      profile: null,
    })
    expect(getGlobalModelProfile('codex')).toEqual({ enabled: false })
  })
})

function createProfile(runtime: 'claude' | 'codex') {
  const provider = modelProviderStore.create({
    name: `${runtime}-provider`,
    displayName: `${runtime} Provider`,
    protocol: runtime === 'claude' ? 'claude' : 'openai',
    baseUrl: 'https://example.com',
    apiKey: 'sk-test',
  })
  const profile = modelProfileStore.create({
    name: `${runtime} profile`,
    runtime,
    providerId: provider.id,
    config: runtime === 'claude' ? { defaultModel: 'claude-model' } : { model: 'codex-model' },
  })
  return { provider, profile }
}

function callRpc(type: keyof typeof modelRpcHandlers, msg: Record<string, unknown>): unknown {
  let result: unknown
  modelRpcHandlers[type](msg as never, {
    state: { subscriptions: new Set(), authMode: 'owner' },
    sendResult: (data) => { result = data },
    sendError: () => undefined,
    sendOutOfBandError: () => undefined,
  })
  return result
}
