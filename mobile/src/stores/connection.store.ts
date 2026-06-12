import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'

const STORAGE_KEY = 'ai-ide-mobile-server'
const CONNECTION_TIMEOUT_MS = 5000

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed'

interface ConnectionState {
  serverUrl: string
  token: string
  connected: boolean
  status: ConnectionStatus
  lastError: string
  init: () => void
  setServer: (url: string, token?: string) => void
  disconnect: () => void
}

let listenerRegistered = false
let connectionTimer: ReturnType<typeof setTimeout> | null = null

function clearConnectionTimer(): void {
  if (!connectionTimer) return
  clearTimeout(connectionTimer)
  connectionTimer = null
}

function startConnectionTimer(set: (p: Partial<ConnectionState>) => void): void {
  clearConnectionTimer()
  connectionTimer = setTimeout(() => {
    set({
      connected: false,
      status: 'failed',
      lastError: '连接失败，请检查地址或 Token',
    })
  }, CONNECTION_TIMEOUT_MS)
}

function ensureListener(set: (p: Partial<ConnectionState> | ((state: ConnectionState) => Partial<ConnectionState>)) => void) {
  if (listenerRegistered) return
  listenerRegistered = true
  wsClient.on('connection', (msg) => {
    const connected = msg.connected === true
    if (connected) clearConnectionTimer()
    set((state) => {
      if (!connected && state.status === 'connecting') {
        return { connected: false }
      }
      return {
        connected,
        status: connected ? 'connected' : 'failed',
        lastError: connected ? '' : '连接已断开，请检查服务器状态',
      }
    })
  })
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  serverUrl: '',
  token: '',
  connected: false,
  status: 'idle',
  lastError: '',

  init: () => {
    ensureListener(set)
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    try {
      const { serverUrl, token } = JSON.parse(saved)
      if (serverUrl) {
        set({ serverUrl, token: token || '', connected: false, status: 'connecting', lastError: '' })
        wsClient.connect(buildWsUrl(serverUrl, token))
        startConnectionTimer(set)
      }
    } catch { /* ignore */ }
  },

  setServer: (url, token) => {
    ensureListener(set)
    const t = token || ''
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ serverUrl: url, token: t }))
    set({ serverUrl: url, token: t, connected: false, status: 'connecting', lastError: '' })
    wsClient.connect(buildWsUrl(url, t))
    startConnectionTimer(set)
  },

  disconnect: () => {
    clearConnectionTimer()
    localStorage.removeItem(STORAGE_KEY)
    wsClient.disconnect()
    set({ serverUrl: '', token: '', connected: false, status: 'idle', lastError: '' })
  },
}))

function buildWsUrl(serverUrl: string, token?: string): string {
  const base = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '')
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}
