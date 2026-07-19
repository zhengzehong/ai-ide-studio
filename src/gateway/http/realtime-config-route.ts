import type { Hono } from 'hono'

export type RealtimeMode = 'process' | 'embedded'

export interface RealtimeEndpointState {
  mode: RealtimeMode
  host: string
  port: number
  legacyRpcEnabled: boolean
}

export function mountRealtimeConfigRoute(
  app: Hono,
  resolveState: () => RealtimeEndpointState,
): void {
  app.get('/api/v1/realtime-config', (context) => {
    const state = resolveState()
    const requestUrl = new URL(context.req.url)
    const forwardedHost = context.req.header('x-forwarded-host')?.split(',')[0]?.trim()
    const requestHost = forwardedHost || requestUrl.host
    const hostname = requestHost.startsWith('[')
      ? requestHost.slice(1, requestHost.indexOf(']'))
      : requestHost.split(':')[0]
    const publicHost = isWildcardHost(state.host) ? hostname : state.host
    const forwardedProtocol = context.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
    const secure = forwardedProtocol === 'https' || requestUrl.protocol === 'https:'
    const wsUrl = `${secure ? 'wss' : 'ws'}://${formatHost(publicHost)}:${state.port}`

    return context.json({
      wsUrl,
      protocolVersion: '1',
      legacyRpcEnabled: state.legacyRpcEnabled,
      mode: state.mode,
    })
  })
}

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === ''
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}
