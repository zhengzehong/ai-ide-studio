import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'

const STORAGE_KEY = 'ai-ide-mobile-server'

interface ConnectionState {
  serverUrl: string
  token: string
  connected: boolean
  init: () => void
  setServer: (url: string, token?: string) => void
  disconnect: () => void
}

let listenerRegistered = false

function ensureListener(set: (p: Partial<ConnectionState>) => void) {
  if (listenerRegistered) return
  listenerRegistered = true
  wsClient.on('connection', (msg) => set({ connected: msg.connected as boolean }))
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  serverUrl: '',
  token: '',
  connected: false,

  init: () => {
    ensureListener(set)
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    try {
      const { serverUrl, token } = JSON.parse(saved)
      if (serverUrl) {
        set({ serverUrl, token: token || '' })
        wsClient.connect(buildWsUrl(serverUrl, token))
      }
    } catch { /* ignore */ }
  },

  setServer: (url, token) => {
    ensureListener(set)
    const t = token || ''
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ serverUrl: url, token: t }))
    set({ serverUrl: url, token: t, connected: false })
    wsClient.connect(buildWsUrl(url, t))
  },

  disconnect: () => {
    localStorage.removeItem(STORAGE_KEY)
    wsClient.disconnect()
    set({ serverUrl: '', token: '', connected: false })
  },
}))

function buildWsUrl(serverUrl: string, token?: string): string {
  const base = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '')
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}
