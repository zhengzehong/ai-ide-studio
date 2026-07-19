export interface RealtimeEndpointDiscoveryOptions {
  apiBase?: string
  token?: string
  shareToken?: string
  fetchImpl?: typeof fetch
  fallbackUrl: string
}

export async function discoverRealtimeEndpoint(
  options: RealtimeEndpointDiscoveryOptions,
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch
  const apiBase = options.apiBase?.replace(/\/$/, '') ?? ''
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.token) headers['x-ai-ide-token'] = options.token
  try {
    const response = await fetchImpl(`${apiBase}/api/v1/realtime-config`, { headers })
    const body = await response.json() as unknown
    if (!response.ok || !isRecord(body) || typeof body.wsUrl !== 'string') {
      throw new Error(`Realtime endpoint discovery failed (${response.status})`)
    }
    return appendAuth(body.wsUrl, options.token, options.shareToken)
  } catch {
    return options.fallbackUrl
  }
}

function appendAuth(url: string, token?: string, shareToken?: string): string {
  const parsed = new URL(url)
  if (shareToken) parsed.searchParams.set('shareToken', shareToken)
  else if (token) parsed.searchParams.set('token', token)
  if (parsed.pathname === '/') {
    return `${parsed.protocol}//${parsed.host}${parsed.search}${parsed.hash}`
  }
  return parsed.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
