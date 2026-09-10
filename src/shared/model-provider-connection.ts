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

/** claude runtime 的 baseUrl 归一:仅 new-api 协议补 /anthropic 后缀(单一来源,勿在调用方复制口径)。 */
export function normalizeClaudeBaseUrl(baseUrl: string, protocol: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (protocol !== 'new-api') return normalized
  return normalized.endsWith('/anthropic') ? normalized : `${normalized}/anthropic`
}
