import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

interface ConnectionStore {
  connected: boolean
  init: () => void
}

let initialized = false

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  init: () => {
    if (initialized) return
    initialized = true
    const url = resolveWsUrl()
    wsClient.on('connection', (msg) => {
      set({ connected: msg.connected as boolean })
    })
    wsClient.connect(url)
  },
}))

export function resolveWsUrl(location: Location = window.location): string {
  const explicitUrl = import.meta.env.VITE_WS_URL as string | undefined
  if (explicitUrl?.trim()) return explicitUrl.trim()

  const token = new URLSearchParams(location.search).get('token')
  const explicitPort = import.meta.env.VITE_WS_PORT as string | undefined
  const devPort = import.meta.env.DEV ? (explicitPort?.trim() || '18800') : explicitPort?.trim()
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const host = devPort ? `${location.hostname}:${devPort}` : location.host
  const query = token ? `?token=${encodeURIComponent(token)}` : ''

  return `${protocol}://${host}${query}`
}
