import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'

const STORAGE_KEY = 'ai-ide-mobile-server'
const CONNECTION_TIMEOUT_MS = 5000

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed'

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

function resolveConnectionError(msg?: Record<string, unknown>, fallback = '连接已断开，请检查服务器状态'): string {
  const raw = msg?.message ?? msg?.error
  return typeof raw === 'string' && raw.trim() ? raw : fallback
}

function connectToServer(url: string, token: string, set: (p: Partial<ConnectionState>) => void): void {
  startConnectionTimer(set)
  try {
    wsClient.connect(buildWsUrl(url, token))
  } catch (error) {
    clearConnectionTimer()
    set({
      connected: false,
      status: 'failed',
      lastError: resolveConnectionError({ message: error instanceof Error ? error.message : String(error) }),
    })
  }
}

function ensureListener(set: (p: Partial<ConnectionState> | ((state: ConnectionState) => Partial<ConnectionState>)) => void) {
  if (listenerRegistered) return
  listenerRegistered = true
  wsClient.on('connection', (msg) => {
    const connected = msg.connected === true
    clearConnectionTimer()
    set((state) => ({
      connected,
      status: connected ? 'connected' : 'failed',
      lastError: connected ? '' : resolveConnectionError(msg, state.lastError || '连接失败，请检查地址或 Token'),
    }))
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
        const t = token || ''
        set({ serverUrl, token: t, connected: false, status: 'connecting', lastError: '' })
        connectToServer(serverUrl, t, set)
      }
    } catch { /* ignore */ }
  },

  setServer: (url, token) => {
    ensureListener(set)
    const t = token || ''
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ serverUrl: url, token: t }))
    set({ serverUrl: url, token: t, connected: false, status: 'connecting', lastError: '' })
    connectToServer(url, t, set)
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
