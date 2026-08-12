import { create } from 'zustand'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { resolveMobileRealtimeUrl, useConnectionStore } from './connection.store'
import { voicePlugin, type VoiceState, type VoiceStatus } from '../services/voice'

const STORAGE_KEY = 'ai-ide-mobile-voice-target'

interface VoiceTarget {
  projectId: string
  agentId: string
  sessionId: string
}

interface VoiceStore {
  enabled: boolean
  state: VoiceState
  message: string
  projectId: string | null
  agentId: string | null
  sessionId: string | null
  hydrated: boolean
  hydrate: () => Promise<void>
  setTarget: (target: Partial<VoiceTarget>) => void
  start: () => Promise<void>
  stop: () => Promise<void>
  setupListeners: () => () => void
}

function readTarget(): Partial<VoiceTarget> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const value = JSON.parse(raw) as Record<string, unknown>
    return {
      projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
      agentId: typeof value.agentId === 'string' ? value.agentId : undefined,
      sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    }
  } catch {
    return {}
  }
}

function saveTarget(target: Partial<VoiceTarget>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(target))
}

function applyStatus(status: VoiceStatus): Partial<VoiceStore> {
  return {
    ...(typeof status.enabled === 'boolean' ? { enabled: status.enabled } : {}),
    state: status.state,
    message: status.message ?? '',
    ...(status.projectId !== undefined ? { projectId: status.projectId ?? null } : {}),
    ...(status.agentId !== undefined ? { agentId: status.agentId ?? null } : {}),
    ...(status.sessionId !== undefined ? { sessionId: status.sessionId ?? null } : {}),
  }
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  enabled: false,
  state: 'disabled',
  message: '',
  projectId: null,
  agentId: null,
  sessionId: null,
  hydrated: false,

  hydrate: async () => {
    const target = readTarget()
    set({
      projectId: target.projectId ?? null,
      agentId: target.agentId ?? null,
      sessionId: target.sessionId ?? null,
    })
    try {
      const status = await voicePlugin.getStatus()
      set({ ...applyStatus(status), hydrated: true })
    } catch {
      set({ hydrated: true })
    }
  },

  setTarget: (target) => {
    const current = get()
    const next = {
      projectId: target.projectId ?? current.projectId ?? '',
      agentId: target.agentId ?? current.agentId ?? '',
      sessionId: target.sessionId ?? current.sessionId ?? '',
    }
    saveTarget(next)
    set({ projectId: next.projectId || null, agentId: next.agentId || null, sessionId: next.sessionId || null })
  },

  start: async () => {
    const { projectId, agentId, sessionId } = get()
    if (!projectId || !agentId || !sessionId) throw new Error('请先选择项目、Agent 和会话')
    if (!Capacitor.isNativePlatform()) throw new Error('实时对话仅支持 Android App')
    const connection = useConnectionStore.getState()
    if (!connection.connected) throw new Error('请先连接服务器')
    set({ enabled: true, state: 'starting', message: '' })
    try {
      const wsUrl = await resolveMobileRealtimeUrl(connection.serverUrl, connection.token)
      await voicePlugin.start({ wsUrl, token: connection.token, projectId, agentId, sessionId })
      saveTarget({ projectId, agentId, sessionId })
      set({ enabled: true, state: 'connecting' })
    } catch (error) {
      set({ enabled: false, state: 'error', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  stop: async () => {
    await voicePlugin.stop()
    set({ enabled: false, state: 'disabled', message: '' })
  },

  setupListeners: () => {
    let handle: PluginListenerHandle | undefined
    let cancelled = false
    void voicePlugin.addListener('status', (status) => set(applyStatus(status)))
      .then((next) => {
        if (cancelled) void next.remove()
        else handle = next
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      void handle?.remove()
    }
  },
}))

export function voiceStateLabel(state: VoiceState): string {
  const labels: Record<VoiceState, string> = {
    disabled: '未开启',
    stopped: '已停止',
    starting: '正在启动',
    connecting: '连接中',
    listening: '监听中',
    sending: '发送中',
    speaking: 'AI 播放中',
    reconnecting: '重新连接中',
    error: '异常',
  }
  return labels[state]
}
