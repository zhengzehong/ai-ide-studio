import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDatabase, closeDatabase } from '../../store/db.js'
import { agentStore } from '../../store/agents.js'
import { modelProviderStore } from '../../store/model-providers.js'
import { modelProfileStore } from '../../store/model-profiles.js'
import { setCaptureSettings, MODEL_CAPTURE_PROXY_PORT_ENV } from '../capture-config.js'
import { buildAgentRuntimeEnv, fingerprintRuntimeEnv } from '../../acp/model-profile-env.js'
import { startModelCaptureProxy, type ModelCaptureProxy } from '../proxy-server.js'
import http from 'node:http'
import { setGlobalModelProfile } from '../../acp/runtime-global-model-profile.js'
import { acquireCaptureRoute, retainCaptureRoute } from '../route-bindings.js'

let tmp: string
let proxy: ModelCaptureProxy

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'capture-inject-'))
  initDatabase(join(tmp, 'test.sqlite'))
  process.env[MODEL_CAPTURE_PROXY_PORT_ENV] = '3987'
  proxy = await startModelCaptureProxy({ port: 0, dataDir: tmp })
})

afterEach(async () => {
  await proxy.close()
  delete process.env[MODEL_CAPTURE_PROXY_PORT_ENV]
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function setupAgent(runtime: 'claude' | 'codex'): { agentId: string; providerBaseUrl: string } {
  const providerBaseUrl = runtime === 'claude'
    ? 'http://127.0.0.1:19000/anthropic'
    : 'http://127.0.0.1:19000'
  const provider = modelProviderStore.create({
    name: `p-${Math.random().toString(36).slice(2, 8)}`,
    displayName: '注入测试供应商',
    protocol: runtime === 'claude' ? 'claude' : 'openai',
    baseUrl: providerBaseUrl,
    apiKey: 'sk-inject-key',
  })
  const config = runtime === 'claude' ? { defaultModel: 'test-model' } : { model: 'test-model' }
  const profile = modelProfileStore.create({
    name: `prof-${Math.random().toString(36).slice(2, 8)}`,
    runtime,
    providerId: provider.id,
    config,
  })
  const agent = agentStore.create({
    name: `agent-${Math.random().toString(36).slice(2, 8)}`,
    type: 'dev',
    runtime,
    config: { modelProfileMode: 'fixed', modelProfileId: profile.id },
  })
  return { agentId: agent.id, providerBaseUrl }
}

test.each(['claude', 'codex'] as const)('%s preserves connection changes in fingerprint', (runtime) => {
  const { agentId } = setupAgent(runtime)
  const agent = agentStore.get(agentId)!
  setCaptureSettings({ enabled: true })
  const first = buildAgentRuntimeEnv(runtime, agent)
  modelProviderStore.update(first.appliedProfile!.providerId, { baseUrl: 'http://127.0.0.1:19001' })
  const second = buildAgentRuntimeEnv(runtime, agent)
  const fingerprint = (value: typeof first): string => JSON.stringify([
    fingerprintRuntimeEnv(value.env, runtime), value.gatewayAuth?.fingerprint,
  ])
  expect(fingerprint(first)).not.toBe(fingerprint(second))
  expect(fingerprint(second)).toBe(fingerprint(buildAgentRuntimeEnv(runtime, agent)))
})

test.each(['claude', 'codex'] as const)('%s port conflict keeps the direct connection', async (runtime) => {
  const { agentId } = setupAgent(runtime)
  setCaptureSettings({ enabled: true })
  await proxy.close()
  const occupied = http.createServer()
  await new Promise<void>((done) => occupied.listen(0, '127.0.0.1', done))
  try {
    proxy = await startModelCaptureProxy({ port: (occupied.address() as { port: number }).port, dataDir: tmp })
    expect(proxy.listening).toBe(false)
    const result = buildAgentRuntimeEnv(runtime, agentStore.get(agentId)!)
    expect(result.captureBinding).toBeUndefined()
    expect(result.env.ANTHROPIC_BASE_URL ?? result.gatewayAuth?.baseUrl).toContain('19000')
  } finally {
    await new Promise<void>((done) => occupied.close(() => done()))
  }
})

test('global selection changes do not mutate retained Runtime bindings', () => {
  const first = setupAgent('claude')
  const second = setupAgent('claude')
  const firstProfileId = JSON.parse(agentStore.get(first.agentId)!.config_json!).modelProfileId as string
  const secondProfileId = JSON.parse(agentStore.get(second.agentId)!.config_json!).modelProfileId as string
  const global = agentStore.create({ name: 'global', type: 'dev', runtime: 'claude', config: { modelProfileMode: 'global' } })
  setCaptureSettings({ enabled: true })
  setGlobalModelProfile('claude', firstProfileId)
  const old = buildAgentRuntimeEnv('claude', global).captureBinding!
  const release = retainCaptureRoute(old)
  setGlobalModelProfile('claude', secondProfileId)
  const next = buildAgentRuntimeEnv('claude', global).captureBinding!
  expect(next.id).not.toBe(old.id)
  const lease = acquireCaptureRoute(old.id)!
  expect(lease.binding.profileId).toBe(firstProfileId)
  lease.release()
  release()
  const direct = { ...global, config_json: JSON.stringify({ modelProfileMode: 'system' }) }
  expect(buildAgentRuntimeEnv('claude', direct, {}).captureBinding).toBeUndefined()
})

test('enabled capture without a listening proxy keeps the direct connection', async () => {
  const { agentId, providerBaseUrl } = setupAgent('claude')
  setCaptureSettings({ enabled: true })
  await proxy.close()
  expect(buildAgentRuntimeEnv('claude', agentStore.get(agentId)!).env.ANTHROPIC_BASE_URL).toBe(providerBaseUrl)
})

describe('模型代理抓包注入(总开关)', () => {
  test('claude 开:ANTHROPIC_BASE_URL 指向本地代理并带 agent 前缀', () => {
    const { agentId } = setupAgent('claude')
    setCaptureSettings({ enabled: true })
    const result = buildAgentRuntimeEnv('claude', agentStore.get(agentId)!)
    expect(result.env.ANTHROPIC_BASE_URL).toMatch(new RegExp(`^http://127.0.0.1:${proxy.port}/route/`))
    expect(result.env.ANTHROPIC_API_KEY).toBe('sk-inject-key')
  })

  test('claude 关:BASE_URL 保持 provider 原样(runtime 行为零变化)', () => {
    const { agentId, providerBaseUrl } = setupAgent('claude')
    setCaptureSettings({ enabled: false })
    const result = buildAgentRuntimeEnv('claude', agentStore.get(agentId)!)
    expect(result.env.ANTHROPIC_BASE_URL).toBe(providerBaseUrl)
  })

  test('codex 开:gatewayAuth.baseUrl 指向代理,fingerprint 随开关变化', () => {
    const { agentId } = setupAgent('codex')
    const agent = agentStore.get(agentId)!
    setCaptureSettings({ enabled: true })
    const on = buildAgentRuntimeEnv('codex', agent)
    expect(on.gatewayAuth?.baseUrl).toMatch(new RegExp(`^http://127.0.0.1:${proxy.port}/route/`))

    setCaptureSettings({ enabled: false })
    const off = buildAgentRuntimeEnv('codex', agent)
    expect(off.gatewayAuth?.baseUrl).toBe('http://127.0.0.1:19000/v1')

    // fingerprint 覆盖 gatewayAuth:开关切换必须改变指纹(触发 agent 进程自动重启)
    const onFp = JSON.stringify([fingerprintRuntimeEnv(on.env, 'codex'), on.gatewayAuth?.fingerprint ?? null])
    const offFp = JSON.stringify([fingerprintRuntimeEnv(off.env, 'codex'), off.gatewayAuth?.fingerprint ?? null])
    expect(onFp).not.toBe(offFp)
  })

  test('claude 开关切换改变 env fingerprint(自动重启生效的前提)', () => {
    const { agentId } = setupAgent('claude')
    const agent = agentStore.get(agentId)!
    setCaptureSettings({ enabled: false })
    const off = buildAgentRuntimeEnv('claude', agent)
    setCaptureSettings({ enabled: true })
    const on = buildAgentRuntimeEnv('claude', agent)
    expect(fingerprintRuntimeEnv(on.env, 'claude')).not.toBe(fingerprintRuntimeEnv(off.env, 'claude'))
  })
})
