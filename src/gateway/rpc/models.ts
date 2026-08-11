import { modelProfileStore, type ModelProfileConfig, type ModelProfileRuntime } from '../../store/model-profiles.js'
import { modelProviderStore } from '../../store/model-providers.js'
import { buildProviderModelsUrl, isProviderProtocolCompatible } from '../../shared/model-provider-connection.js'
import { clearGlobalModelProfile, getGlobalModelProfile, setGlobalModelProfile } from '../../acp/runtime-global-model-profile.js'
import type { RpcHandlerMap } from './types.js'

type ModelProtocol = 'openai' | 'claude' | 'new-api'
type ModelItem = { id: string; name: string; isDefault?: boolean }

async function fetchProviderModels(protocol: string, baseUrl: string, apiKey: string): Promise<string[]> {
  const url = buildProviderModelsUrl(baseUrl)
  const headers: Record<string, string> = protocol === 'claude'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${apiKey}` }
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().then(t => t.slice(0, 200))}`)
  const data = await resp.json() as { data?: { id: string }[] }
  return data.data?.map(m => m.id) ?? []
}

function requireRuntime(value: unknown): ModelProfileRuntime {
  if (value === 'claude' || value === 'codex') return value
  throw new Error('模型档案运行时仅支持 claude 或 codex')
}

function normalizeContextWindow(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('模型上下文必须是正数')
  return Math.floor(parsed)
}

function requireProfileConfig(value: unknown): ModelProfileConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型档案配置不能为空')
  return value as ModelProfileConfig
}

function ensureProvider(providerId: string, runtime?: ModelProfileRuntime): void {
  const provider = modelProviderStore.get(providerId)
  if (!provider) throw new Error('模型供应商不存在')
  if (runtime && !isProviderProtocolCompatible(runtime, provider.protocol)) {
    throw new Error(`供应商协议 ${provider.protocol} 与 ${runtime} 运行时不兼容`)
  }
}

export const modelRpcHandlers: RpcHandlerMap = {
  'models.list'(_msg, { sendResult }) {
    sendResult(modelProviderStore.list())
  },

  'models.create'(msg, { sendResult }) {
    const provider = modelProviderStore.create({
      name: msg.name as string,
      displayName: msg.displayName as string,
      protocol: msg.protocol as ModelProtocol,
      baseUrl: msg.baseUrl as string,
      apiKey: msg.apiKey as string,
      models: msg.models as ModelItem[] | undefined,
      isDefault: msg.isDefault as boolean | undefined,
    })
    sendResult(provider)
  },

  'models.update'(msg, { sendResult }) {
    const updated = modelProviderStore.update(msg.providerId as string, {
      displayName: msg.displayName as string | undefined,
      protocol: msg.protocol as ModelProtocol | undefined,
      baseUrl: msg.baseUrl as string | undefined,
      apiKey: msg.apiKey as string | undefined,
      models: msg.models as ModelItem[] | undefined,
      isDefault: msg.isDefault as boolean | undefined,
    })
    if (!updated) throw new Error('模型供应商不存在')
    sendResult(updated)
  },

  'models.toggle'(msg, { sendResult }) {
    modelProviderStore.toggle(msg.providerId as string, msg.enabled as boolean)
    sendResult({ ok: true })
  },

  'models.delete'(msg, { sendResult }) {
    modelProviderStore.delete(msg.providerId as string)
    sendResult({ ok: true })
  },

  'models.setDefault'(msg, { sendResult }) {
    modelProviderStore.setDefault(msg.providerId as string)
    sendResult({ ok: true })
  },

  async 'models.test'(msg, { sendResult }) {
    try {
      const provider = modelProviderStore.get(msg.providerId as string)
      if (!provider) throw new Error('模型供应商不存在')
      if (provider.protocol !== 'openai' && provider.protocol !== 'claude' && provider.protocol !== 'new-api') {
        throw new Error(`不支持的协议: ${provider.protocol}`)
      }
      sendResult({ ok: true, models: await fetchProviderModels(provider.protocol, provider.base_url, provider.api_key) })
    } catch (e) {
      sendResult({ ok: false, error: (e as Error).message })
    }
  },

  'modelProfiles.list'(msg, { sendResult }) {
    const runtime = msg.runtime === undefined ? undefined : requireRuntime(msg.runtime)
    sendResult(modelProfileStore.list({ runtime, enabledOnly: msg.enabledOnly as boolean | undefined }))
  },

  'modelProfiles.global.get'(msg, { sendResult }) {
    const runtime = requireRuntime(msg.runtime)
    sendResult(readActiveGlobalProfile(runtime))
  },

  'modelProfiles.global.set'(msg, { sendResult }) {
    const runtime = requireRuntime(msg.runtime)
    const profileId = typeof msg.profileId === 'string' ? msg.profileId.trim() : ''
    if (!profileId) throw new Error('全局模型档案不能为空')
    const profile = modelProfileStore.get(profileId)
    if (!profile || profile.enabled !== 1) throw new Error('模型档案不存在或已禁用')
    if (profile.runtime !== runtime) throw new Error('模型档案 Runtime 不匹配')
    const provider = modelProviderStore.get(profile.provider_id)
    if (!provider || provider.enabled !== 1) throw new Error('模型档案对应的供应商不存在或已禁用')
    if (!isProviderProtocolCompatible(runtime, provider.protocol)) {
      throw new Error(`供应商协议 ${provider.protocol} 与 ${runtime} 运行时不兼容`)
    }
    setGlobalModelProfile(runtime, profileId)
    sendResult({ runtime, enabled: true, profileId, profile })
  },

  'modelProfiles.global.clear'(msg, { sendResult }) {
    const runtime = requireRuntime(msg.runtime)
    clearGlobalModelProfile(runtime)
    sendResult({ runtime, enabled: false, profileId: null, profile: null })
  },

  'modelProfiles.create'(msg, { sendResult }) {
    const runtime = requireRuntime(msg.runtime)
    const providerId = msg.providerId as string
    ensureProvider(providerId, runtime)
    sendResult(modelProfileStore.create({
      name: msg.name as string,
      runtime,
      providerId,
      contextWindow: normalizeContextWindow(msg.contextWindow),
      config: requireProfileConfig(msg.config),
    }))
  },

  'modelProfiles.update'(msg, { sendResult }) {
    const existing = modelProfileStore.get(msg.profileId as string)
    if (!existing) throw new Error('模型档案不存在')
    const fields: Parameters<typeof modelProfileStore.update>[1] = {}
    if (msg.name !== undefined) fields.name = msg.name as string
    if (msg.runtime !== undefined) fields.runtime = requireRuntime(msg.runtime)
    if (msg.providerId !== undefined) {
      fields.providerId = msg.providerId as string
      ensureProvider(fields.providerId)
    }
    if (msg.contextWindow !== undefined) fields.contextWindow = normalizeContextWindow(msg.contextWindow)
    if (msg.config !== undefined) fields.config = requireProfileConfig(msg.config)
    ensureProvider(
      fields.providerId ?? existing.provider_id,
      fields.runtime ?? existing.runtime as ModelProfileRuntime,
    )
    const updated = modelProfileStore.update(msg.profileId as string, fields)
    if (!updated) throw new Error('模型档案不存在')
    sendResult(updated)
  },

  'modelProfiles.toggle'(msg, { sendResult }) {
    modelProfileStore.toggle(msg.profileId as string, msg.enabled as boolean)
    sendResult({ ok: true })
  },

  'modelProfiles.setDefault'(msg, { sendResult }) {
    sendResult(modelProfileStore.setDefault(msg.profileId as string))
  },

  'modelProfiles.delete'(msg, { sendResult }) {
    modelProfileStore.delete(msg.profileId as string)
    sendResult({ ok: true })
  },
}

function readActiveGlobalProfile(runtime: ModelProfileRuntime): {
  runtime: ModelProfileRuntime
  enabled: boolean
  profileId: string | null
  profile: ReturnType<typeof modelProfileStore.get> | null
} {
  const state = getGlobalModelProfile(runtime)
  const profile = state.profileId ? modelProfileStore.get(state.profileId) : undefined
  const provider = profile ? modelProviderStore.get(profile.provider_id) : undefined
  const valid = state.enabled
    && profile?.enabled === 1
    && profile.runtime === runtime
    && provider?.enabled === 1
    && isProviderProtocolCompatible(runtime, provider.protocol)
  if (!valid) {
    if (state.enabled || state.profileId) clearGlobalModelProfile(runtime)
    return { runtime, enabled: false, profileId: null, profile: null }
  }
  return { runtime, enabled: true, profileId: profile.id, profile }
}
