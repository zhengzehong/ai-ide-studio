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

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capture-inject-'))
  initDatabase(join(tmp, 'test.sqlite'))
  process.env[MODEL_CAPTURE_PROXY_PORT_ENV] = '3987'
})

afterEach(() => {
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

describe('模型代理抓包注入(总开关)', () => {
  test('claude 开:ANTHROPIC_BASE_URL 指向本地代理并带 agent 前缀', () => {
    const { agentId } = setupAgent('claude')
    setCaptureSettings({ enabled: true })
    const result = buildAgentRuntimeEnv('claude', agentStore.get(agentId)!)
    expect(result.env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:3987/agent-${agentId}`)
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
    expect(on.gatewayAuth?.baseUrl).toBe(`http://127.0.0.1:3987/agent-${agentId}`)

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
