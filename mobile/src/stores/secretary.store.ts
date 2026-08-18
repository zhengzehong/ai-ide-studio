import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'
import type { SecretaryRunData } from '@desktop/stores/secretary.store'

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
  runtimeSessionId: string | null
  chatSessionId: string | null
  enabled: boolean
  observeAll: boolean
  observedAgentIds: string[]
  triggers: Array<{ id: string; type: string; cron: string | null; enabled: boolean }>
  lastRunAt: string | null
  lastError: string | null
  unreadCount: number
  chatUnread: boolean
}

interface MobileSecretaryState {
  projectId: string | null
  secretaries: MobileSecretary[]
  selectedId: string | null
  threads: MobileSecretaryThread[]
  runs: SecretaryRunData[]
  loading: boolean
  runsLoading: boolean
  saving: boolean
  error: string
  load: (projectId: string) => Promise<void>
  create: (projectId: string, input: Record<string, unknown>) => Promise<void>
  update: (projectId: string, secretaryId: string, input: Record<string, unknown>) => Promise<void>
  remove: (projectId: string, secretaryId: string) => Promise<void>
  select: (projectId: string, secretaryId: string) => Promise<void>
  markRead: (projectId: string, secretaryId: string, threadId: string) => Promise<void>
  archive: (projectId: string, secretaryId: string, threadId: string) => Promise<void>
  runNow: (projectId: string, secretaryId: string) => Promise<void>
  setupListeners: () => () => void
}

let secretaryLoadRequestSeq = 0
let secretaryDetailRequestSeq = 0

export const useMobileSecretaryStore = create<MobileSecretaryState>((set, get) => ({
  projectId: null, secretaries: [], selectedId: null, threads: [], runs: [], loading: false, runsLoading: false, saving: false, error: '',
  load: async (projectId) => {
    const requestSeq = ++secretaryLoadRequestSeq
    const previousProjectId = get().projectId
    set({ projectId, loading: true, error: '' })
    try {
      const secretaries = await wsClient.request({ type: 'secretary.list', projectId }) as MobileSecretary[]
      if (requestSeq !== secretaryLoadRequestSeq) return
      const selectedId = previousProjectId === projectId && secretaries.some((item) => item.id === get().selectedId)
        ? get().selectedId
        : secretaries[0]?.id ?? null
      set({ secretaries, selectedId, loading: false })
      if (selectedId) await get().select(projectId, selectedId)
      else set({ threads: [], runs: [] })
    } catch (error) {
      if (requestSeq !== secretaryLoadRequestSeq) return
      set({ loading: false, error: error instanceof Error ? error.message : '秘书加载失败' })
    }
  },
  create: async (projectId, input) => {
    set({ saving: true, error: '' })
    try {
      const secretary = await wsClient.request({ type: 'secretary.create', projectId, ...input }) as MobileSecretary
      set({ secretaries: [secretary, ...get().secretaries], selectedId: secretary.id, saving: false })
      await get().select(projectId, secretary.id)
    } catch (error) {
      set({ saving: false, error: error instanceof Error ? error.message : '秘书创建失败' })
      throw error
    }
  },
  update: async (projectId, secretaryId, input) => {
    set({ saving: true, error: '' })
    try {
      const secretary = await wsClient.request({ type: 'secretary.update', projectId, secretaryId, ...input }) as MobileSecretary
      set({
        secretaries: get().secretaries.map((item) => item.id === secretary.id ? secretary : item),
        saving: false,
      })
    } catch (error) {
      set({ saving: false, error: error instanceof Error ? error.message : '秘书保存失败' })
      throw error
    }
  },
  remove: async (projectId, secretaryId) => {
    try {
      await wsClient.request({ type: 'secretary.delete', projectId, secretaryId })
      const secretaries = get().secretaries.filter((item) => item.id !== secretaryId)
      const selectedId = get().selectedId === secretaryId ? secretaries[0]?.id ?? null : get().selectedId
      set({ secretaries, selectedId, threads: [], runs: [], error: '' })
      if (selectedId) await get().select(projectId, selectedId)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '秘书删除失败' })
      throw error
    }
  },
  select: async (projectId, secretaryId) => {
    const requestSeq = ++secretaryDetailRequestSeq
    set({ selectedId: secretaryId, runsLoading: true })
    try {
      const [threads, runs] = await Promise.all([
        wsClient.request({ type: 'secretary.threads.list', projectId, secretaryId }) as Promise<MobileSecretaryThread[]>,
        wsClient.request({ type: 'secretary.runs.list', projectId, secretaryId, limit: 20 }) as Promise<SecretaryRunData[]>,
      ])
      if (requestSeq !== secretaryDetailRequestSeq || get().selectedId !== secretaryId) return
      set({ threads, runs, runsLoading: false })
    } catch (error) {
      if (requestSeq !== secretaryDetailRequestSeq || get().selectedId !== secretaryId) return
      set({ runsLoading: false, error: error instanceof Error ? error.message : '秘书详情加载失败' })
    }
  },
  markRead: async (projectId, secretaryId, threadId) => {
    try {
      await wsClient.request({ type: 'secretary.thread.markRead', projectId, secretaryId, threadId })
      set({ threads: get().threads.map((item) => item.id === threadId ? { ...item, unread: false } : item) })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '邮件状态更新失败' })
      throw error
    }
  },
  archive: async (projectId, secretaryId, threadId) => {
    try {
      await wsClient.request({ type: 'secretary.thread.archive', projectId, secretaryId, threadId })
      set({ threads: get().threads.filter((item) => item.id !== threadId) })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '邮件归档失败' })
      throw error
    }
  },
  runNow: async (projectId, secretaryId) => {
    try {
      await wsClient.request({ type: 'secretary.runNow', projectId, secretaryId })
      set({ error: '' })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '秘书运行失败' })
      throw error
    }
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
