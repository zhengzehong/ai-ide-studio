import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

interface ConnectionStore {
  connected: boolean
  authRequired: boolean
  authError: string | null
  token: string
  init: () => void
  saveToken: (token: string) => void
}

let initialized = false
const ACCESS_TOKEN_STORAGE_KEY = 'ai-ide-access-token'

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  authRequired: false,
  authError: null,
  token: getStoredAccessToken(),
  init: () => {
    if (initialized) return
    initialized = true
    const url = resolveWsUrl()
    wsClient.on('connection', (msg) => {
      const connected = msg.connected as boolean
      if (connected) {
        set({ connected: true, authRequired: false, authError: null })
        return
      }

      if (isUnauthorizedClose(Number(msg.code), String(msg.reason || ''))) {
        set({ connected: false, authRequired: true, authError: '访问密钥无效或已过期' })
        return
      }

      set({ connected: false })
    })
    wsClient.connect(url)
  },
  saveToken: (token) => {
    const nextToken = token.trim()
    storeAccessToken(nextToken)
    set({ token: nextToken, authRequired: false, authError: null, connected: false })
    wsClient.connect(resolveWsUrl(window.location, nextToken))
  },
}))

export function resolveWsUrl(location: Location = window.location, tokenOverride?: string): string {
  const explicitUrl = import.meta.env.VITE_WS_URL as string | undefined
  if (explicitUrl?.trim()) return explicitUrl.trim()

  const token = tokenOverride ?? new URLSearchParams(location.search).get('token') ?? getStoredAccessToken()
  const explicitPort = import.meta.env.VITE_WS_PORT as string | undefined
  const devPort = import.meta.env.DEV ? (explicitPort?.trim() || '18800') : explicitPort?.trim()
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const host = devPort ? `${location.hostname}:${devPort}` : location.host
  const query = token ? `?token=${encodeURIComponent(token)}` : ''

  return `${protocol}://${host}${query}`
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
