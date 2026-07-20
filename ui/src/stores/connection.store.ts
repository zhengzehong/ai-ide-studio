import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

interface ConnectionClient {
  connect: (url: string) => void
  disconnect: () => void
  on: (event: string, handler: (msg: Record<string, unknown>) => void) => () => void
}

export type AuthMode = 'owner' | 'guest'

interface ConnectionStore {
  connected: boolean
  authRequired: boolean
  authError: string | null
  token: string
  authMode: AuthMode
  init: () => void
  saveToken: (token: string) => void
}

let initialized = false
let connectionClient: ConnectionClient = wsClient
const ACCESS_TOKEN_STORAGE_KEY = 'ai-ide-access-token'

function readGuestShareTokenFromLocation(): string | null {
  if (typeof window === 'undefined' || !window.location) return null
  const match = window.location.pathname.match(/^\/share\/([A-Za-z0-9]+)/)
  return match ? match[1] : null
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  authRequired: false,
  authError: null,
  token: getStoredAccessToken(),
  authMode: readGuestShareTokenFromLocation() ? 'guest' : 'owner',
  init: () => {
    if (initialized) return
    initialized = true
    const url = resolveWsUrl()
    connectionClient.on('connection', (msg) => {
      const connected = msg.connected as boolean
      if (connected) {
        set({ connected: true, authRequired: false, authError: null })
        return
      }

      if (isUnauthorizedClose(Number(msg.code), String(msg.reason || ''))) {
        connectionClient.disconnect()
        set({ connected: false, authRequired: true, authError: '访问密钥无效或已过期' })
        return
      }

      set({ connected: false })
    })
    connectionClient.connect(url)
  },
  saveToken: (token) => {
    const nextToken = token.trim()
    storeAccessToken(nextToken)
    set({ token: nextToken, authRequired: false, authError: null, connected: false, authMode: 'owner' })
    connectionClient.connect(resolveWsUrl(window.location, nextToken))
  },
}))

export function resolveWsUrl(location: Location = window.location, tokenOverride?: string): string {
  const explicitUrl = import.meta.env.VITE_WS_URL as string | undefined
  if (explicitUrl?.trim()) return explicitUrl.trim()

  const explicitPort = import.meta.env.VITE_WS_PORT as string | undefined
  const devPort = import.meta.env.DEV ? (explicitPort?.trim() || '18800') : explicitPort?.trim()
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const host = devPort ? `${location.hostname}:${devPort}` : location.host

  const shareToken = readShareTokenFromPath(location)
  if (shareToken) {
    return `${protocol}://${host}?shareToken=${encodeURIComponent(shareToken)}`
  }

  const token = tokenOverride ?? new URLSearchParams(location.search).get('token') ?? getStoredAccessToken()
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${protocol}://${host}${query}`
}

function readShareTokenFromPath(loc: Location): string | null {
  const match = loc.pathname.match(/^\/share\/([A-Za-z0-9]+)/)
  return match ? match[1] : null
}

export function getStoredAccessToken(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? ''
}

export function storeAccessToken(token: string): void {
  if (typeof localStorage === 'undefined') return
  const nextToken = token.trim()
  if (nextToken) localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, nextToken)
  else localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
}

export function isUnauthorizedClose(code: number, reason: string): boolean {
  void reason
  return code === 1008
}

export function setConnectionClientForTest(client: ConnectionClient | null): void {
  connectionClient = client ?? wsClient
  initialized = false
}
