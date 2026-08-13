import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type VoiceState = 'disabled' | 'starting' | 'connecting' | 'listening' | 'sending' | 'speaking' | 'reconnecting' | 'error' | 'stopped'

export interface VoiceStatus {
  enabled?: boolean
  state: VoiceState
  projectId?: string | null
  agentId?: string | null
  sessionId?: string | null
  message?: string | null
  audioRoute?: 'bluetooth' | 'wired' | 'speaker' | 'unknown'
  audioDevice?: string | null
}

export interface VoiceStartOptions {
  wsUrl: string
  asrWsUrl: string
  token: string
  projectId: string
  agentId: string
  sessionId: string
}

export interface VoicePlugin {
  getStatus(): Promise<VoiceStatus>
  start(options: VoiceStartOptions): Promise<void>
  stop(): Promise<void>
  addListener(eventName: 'status', listener: (status: VoiceStatus) => void): Promise<PluginListenerHandle>
}

export const voicePlugin = registerPlugin<VoicePlugin>('Voice', {
  web: () => ({
    async getStatus(): Promise<VoiceStatus> {
      return { enabled: false, state: 'disabled' }
    },
    async start(): Promise<void> {
      throw new Error('实时对话仅支持 Android App')
    },
    async stop(): Promise<void> {
      return undefined
    },
    async addListener(): Promise<PluginListenerHandle> {
      return { remove: async () => undefined }
    },
  }),
})
