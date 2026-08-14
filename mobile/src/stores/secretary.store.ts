import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'

export interface MobileSecretaryAttachment { path: string; title?: string; kind?: 'text' | 'image' | 'audio' | 'video' | 'binary' }
export interface MobileSecretaryThread {
  id: string
  secretaryId: string
  subject: string
  summary: string
  kind: string
  needsAction: boolean
  unread: boolean
  bodyMarkdown: string
  attachments: MobileSecretaryAttachment[]
  updatedAt: string
}
export interface MobileSecretary {
  id: string
  projectId: string
  name: string
  definitionPrompt: string
  reportPrompt: string
  executionAgentId: string
  chatSessionId: string | null
  enabled: boolean
  observeAll: boolean
  observedAgentIds: string[]
  unreadCount: number
}

interface MobileSecretaryState {
  projectId: string | null
  secretaries: MobileSecretary[]
  selectedId: string | null
  threads: MobileSecretaryThread[]
  loading: boolean
  error: string
  load: (projectId: string) => Promise<void>
  create: (projectId: string, input: Record<string, unknown>) => Promise<void>
  select: (projectId: string, secretaryId: string) => Promise<void>
  markRead: (projectId: string, secretaryId: string, threadId: string) => Promise<void>
  archive: (projectId: string, secretaryId: string, threadId: string) => Promise<void>
  runNow: (projectId: string, secretaryId: string) => Promise<void>
  setupListeners: () => () => void
}

export const useMobileSecretaryStore = create<MobileSecretaryState>((set, get) => ({
  projectId: null, secretaries: [], selectedId: null, threads: [], loading: false, error: '',
  load: async (projectId) => {
    const previousProjectId = get().projectId
    set({ projectId, loading: true, error: '' })
    try {
      const secretaries = await wsClient.request({ type: 'secretary.list', projectId }) as MobileSecretary[]
      const selectedId = previousProjectId === projectId && secretaries.some((item) => item.id === get().selectedId)
        ? get().selectedId
        : secretaries[0]?.id ?? null
      set({ secretaries, selectedId, loading: false })
      if (selectedId) await get().select(projectId, selectedId)
      else set({ threads: [] })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '秘书加载失败' })
    }
  },
  create: async (projectId, input) => {
    await wsClient.request({ type: 'secretary.create', projectId, ...input })
    await get().load(projectId)
  },
  select: async (projectId, secretaryId) => {
    set({ selectedId: secretaryId })
    try {
      const threads = await wsClient.request({ type: 'secretary.threads.list', projectId, secretaryId }) as MobileSecretaryThread[]
      set({ threads })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '邮件加载失败' })
    }
  },
  markRead: async (projectId, secretaryId, threadId) => {
    await wsClient.request({ type: 'secretary.thread.markRead', projectId, secretaryId, threadId })
    set({ threads: get().threads.map((item) => item.id === threadId ? { ...item, unread: false } : item) })
  },
  archive: async (projectId, secretaryId, threadId) => {
    await wsClient.request({ type: 'secretary.thread.archive', projectId, secretaryId, threadId })
    set({ threads: get().threads.filter((item) => item.id !== threadId) })
  },
  runNow: async (projectId, secretaryId) => {
    await wsClient.request({ type: 'secretary.runNow', projectId, secretaryId })
  },
  setupListeners: () => {
    const refreshCurrent = (): void => {
      const projectId = get().projectId
      if (projectId) void get().load(projectId)
    }
    const offUpdate = wsClient.on('secretary:update', (message) => {
      const projectId = typeof message.projectId === 'string' ? message.projectId : ''
      if (projectId && projectId === get().projectId) void get().load(projectId)
    })
    const offReconnect = wsClient.on('reconnected', refreshCurrent)
    return () => { offUpdate(); offReconnect() }
  },
}))
