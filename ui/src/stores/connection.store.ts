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
    const port = import.meta.env.VITE_WS_PORT || '18800'
    const url = `ws://localhost:${port}`
    wsClient.on('connection', (msg) => {
      set({ connected: msg.connected as boolean })
    })
    wsClient.connect(url)
  },
}))
