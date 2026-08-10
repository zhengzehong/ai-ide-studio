export type ProfileRuntime = 'claude' | 'codex'

export function isProviderProtocolCompatible(runtime: ProfileRuntime, protocol: string): boolean {
  if (protocol === 'new-api') return true
  return runtime === 'claude' ? protocol === 'claude' : protocol === 'openai'
}

export function buildProviderModelsUrl(baseUrl: string): string {
  return `${normalizeOpenAiBaseUrl(baseUrl)}/models`
}

export function normalizeOpenAiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}
