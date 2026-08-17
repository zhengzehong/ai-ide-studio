import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface SecretaryAttachment {
  path: string
  title?: string
  kind?: 'text' | 'image' | 'audio' | 'video' | 'binary'
}

export interface SecretaryThread {
  id: string
  secretaryId: string
  threadKey: string
  subject: string
  summary: string
  kind: string
  priority: string
  needsAction: boolean
  unread: boolean
  status: string
  bodyMarkdown: string
  sourceRefs: string[]
  attachments: SecretaryAttachment[]
  createdAt: string
  updatedAt: string
}

export type SecretaryRunStatus = 'pending' | 'running' | 'succeeded' | 'failed'
export interface SecretaryRunData {
  id: string
  eventType: string
  sourceId: string | null
  status: SecretaryRunStatus
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  elapsedMs: number | null
}

export interface SecretaryData {
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
  createdAt: string
  updatedAt: string
}

interface SecretaryState {
  projectId: string | null
  secretaries: SecretaryData[]
  selectedId: string | null
  threads: SecretaryThread[]
  runs: SecretaryRunData[]
  selectedThreadId: string | null
  loading: boolean
  runsLoading: boolean
  saving: boolean
  error: string | null
  load: (projectId: string) => Promise<void>
  select: (projectId: string, secretaryId: string) => Promise<void>
  create: (input: Record<string, unknown>) => Promise<SecretaryData>
  update: (secretaryId: string, input: Record<string, unknown>) => Promise<void>
  remove: (secretaryId: string) => Promise<void>
  runNow: (secretaryId: string) => Promise<void>
  markRead: (secretaryId: string, threadId: string) => Promise<void>
  archive: (secretaryId: string, threadId: string) => Promise<void>
  sendChat: (secretaryId: string, content: string) => Promise<string>
  setupListeners: () => () => void
}

let secretaryLoadRequestSeq = 0
let secretaryDetailRequestSeq = 0

export const useSecretaryStore = create<SecretaryState>((set, get) => ({
  projectId: null,
  secretaries: [],
  selectedId: null,
  threads: [],
  runs: [],
  selectedThreadId: null,
  loading: false,
  runsLoading: false,
  saving: false,
  error: null,

  load: async (projectId) => {
    const requestSeq = ++secretaryLoadRequestSeq
    const previousProjectId = get().projectId
    set({ projectId, loading: true, error: null })
    try {
      const secretaries = await wsClient.request({ type: 'secretary.list', projectId }) as SecretaryData[]
      if (requestSeq !== secretaryLoadRequestSeq) return
      const selectedId = previousProjectId === projectId && get().selectedId && secretaries.some((item) => item.id === get().selectedId)
        ? get().selectedId
        : secretaries[0]?.id ?? null
      set({ secretaries, selectedId, loading: false })
      if (selectedId) await get().select(projectId, selectedId)
      else set({ threads: [], runs: [], selectedThreadId: null })
    } catch (error) {
      if (requestSeq !== secretaryLoadRequestSeq) return
      set({ loading: false, error: error instanceof Error ? error.message : '秘书加载失败' })
    }
  },

  select: async (projectId, secretaryId) => {
    const requestSeq = ++secretaryDetailRequestSeq
    set({ selectedId: secretaryId, selectedThreadId: null, runsLoading: true })
    try {
      const [threads, runs] = await Promise.all([
        wsClient.request({ type: 'secretary.threads.list', projectId, secretaryId }) as Promise<SecretaryThread[]>,
        wsClient.request({ type: 'secretary.runs.list', projectId, secretaryId, limit: 20 }) as Promise<SecretaryRunData[]>,
      ])
      if (requestSeq !== secretaryDetailRequestSeq || get().selectedId !== secretaryId) return
      set({ threads, runs, selectedThreadId: null, runsLoading: false })
    } catch (error) {
      if (requestSeq !== secretaryDetailRequestSeq || get().selectedId !== secretaryId) return
      set({ runsLoading: false, error: error instanceof Error ? error.message : '秘书详情加载失败' })
    }
  },

  create: async (input) => {
    const projectId = get().projectId
    if (!projectId) throw new Error('未选择项目')
    set({ saving: true, error: null })
    try {
      const secretary = await wsClient.request({ type: 'secretary.create', projectId, ...input }) as SecretaryData
      set({ secretaries: [secretary, ...get().secretaries], selectedId: secretary.id, saving: false })
      await get().select(projectId, secretary.id)
      return secretary
    } catch (error) {
      set({ saving: false, error: error instanceof Error ? error.message : '秘书创建失败' })
      throw error
    }
  },

  update: async (secretaryId, input) => {
    const projectId = get().projectId
    if (!projectId) return
    set({ saving: true, error: null })
    try {
      const secretary = await wsClient.request({ type: 'secretary.update', projectId, secretaryId, ...input }) as SecretaryData
      set({ secretaries: get().secretaries.map((item) => item.id === secretary.id ? secretary : item), saving: false })
    } catch (error) {
      set({ saving: false, error: error instanceof Error ? error.message : '秘书保存失败' })
      throw error
    }
  },

  remove: async (secretaryId) => {
    const projectId = get().projectId
    if (!projectId) return
    try {
      await wsClient.request({ type: 'secretary.delete', projectId, secretaryId })
      const secretaries = get().secretaries.filter((item) => item.id !== secretaryId)
      const selectedId = get().selectedId === secretaryId ? secretaries[0]?.id ?? null : get().selectedId
      set({ secretaries, selectedId, error: null })
      if (selectedId) await get().select(projectId, selectedId)
      else set({ threads: [], runs: [], selectedThreadId: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '秘书删除失败' })
      throw error
    }
  },

  runNow: async (secretaryId) => {
    const projectId = get().projectId
    if (!projectId) return
    try {
      await wsClient.request({ type: 'secretary.runNow', projectId, secretaryId })
      set({ error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '秘书运行失败' })
      throw error
    }
  },

  markRead: async (secretaryId, threadId) => {
    const projectId = get().projectId
    if (!projectId) return
    try {
      await wsClient.request({ type: 'secretary.thread.markRead', projectId, secretaryId, threadId })
      set({ threads: get().threads.map((thread) => thread.id === threadId ? { ...thread, unread: false } : thread) })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '邮件状态更新失败' })
      throw error
    }
  },

  archive: async (secretaryId, threadId) => {
    const projectId = get().projectId
    if (!projectId) return
    try {
      await wsClient.request({ type: 'secretary.thread.archive', projectId, secretaryId, threadId })
      const threads = get().threads.filter((thread) => thread.id !== threadId)
      set({ threads, selectedThreadId: threads[0]?.id ?? null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '邮件归档失败' })
      throw error
    }
  },

  sendChat: async (secretaryId, content) => {
    const projectId = get().projectId
    if (!projectId) throw new Error('未选择项目')
    const result = await wsClient.request({ type: 'secretary.chat.send', projectId, secretaryId, content }) as { sessionId: string }
    return result.sessionId
  },

  setupListeners: () => {
    const refreshCurrent = (): void => {
      const projectId = get().projectId
      if (projectId) void get().load(projectId)
    }
    const off = wsClient.on('secretary:update', (message) => {
      const projectId = typeof message.projectId === 'string' ? message.projectId : null
      if (projectId && projectId === get().projectId) void get().load(projectId)
    })
    const offReconnect = wsClient.on('reconnected', refreshCurrent)
    return () => { off(); offReconnect() }
  },
}))
