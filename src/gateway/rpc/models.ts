import { modelProviderStore } from '../../store/model-providers.js'
import type { RpcHandlerMap } from './types.js'

type ModelProtocol = 'openai' | 'claude'
type ModelItem = { id: string; name: string; isDefault?: boolean }

async function fetchProviderModels(protocol: string, baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/models`
  const headers = protocol === 'claude'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${apiKey}` }
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().then(t => t.slice(0, 200))}`)
  const data = await resp.json() as { data?: { id: string }[] }
  return data.data?.map(m => m.id) ?? []
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
    if (!updated) throw new Error('供应商不存在')
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
      if (!provider) throw new Error('供应商不存在')
      if (provider.protocol !== 'openai' && provider.protocol !== 'claude') throw new Error(`不支持的协议: ${provider.protocol}`)
      sendResult({ ok: true, models: await fetchProviderModels(provider.protocol, provider.base_url, provider.api_key) })
    } catch (e) {
      sendResult({ ok: false, error: (e as Error).message })
    }
  },
}
