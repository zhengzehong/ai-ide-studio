import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'

export type MobileSessionAttentionState = 'running' | 'unread'

export interface MobileActivitySession {
  sessionId: string
  taskId: string | null
  taskTitle: string | null
  taskStatus: string | null
  sessionTitle: string | null
  status: string
  stage: string
  running: boolean
  unread: boolean
  attentionState: MobileSessionAttentionState
  activityAt: string
}

export interface MobileActivityGroup {
  teamId?: string
  groupId: string
  agentId: string
  agentName: string
  agentIcon: string | null
  projectId: string | null
  projectName: string | null
  activityAt: string
  sessions: MobileActivitySession[]
}

interface MobileActivityState {
  groups: MobileActivityGroup[]
  loading: boolean
  loaded: boolean
  error: string | null
  load: (options?: { silent?: boolean }) => Promise<void>
  markRead: (sessionId: string) => Promise<void>
  clearUnreadLocally: (sessionId: string) => void
  setupListeners: () => () => void
}

let requestSequence = 0

export const useMobileActivityStore = create<MobileActivityState>((set, get) => ({
  groups: [],
  loading: false,
  loaded: false,
  error: null,

  load: async (options) => {
    const sequence = ++requestSequence
    if (!options?.silent) set({ loading: true, error: null })
    try {
      const groups = await wsClient.request({ type: 'widget.sessionActivity.list' }) as MobileActivityGroup[]
      if (sequence !== requestSequence) return
      set({ groups, loading: false, loaded: true, error: null })
    } catch (error) {
      if (sequence !== requestSequence) return
      set({
        loading: false,
        error: error instanceof Error ? error.message : '动态同步失败',
      })
    }
  },

  markRead: async (sessionId) => {
    requestSequence += 1
    set((state) => ({ groups: clearUnreadSession(state.groups, sessionId) }))
    try {
      await wsClient.request({ type: 'sessions.markRead', sessionId })
    } catch {
      await get().load({ silent: true })
    }
  },

  // 本地乐观清除,不发请求:给"正看着的会话跑完"场景用,已读 RPC 由 session.store 统一发,
  // 避免同一个 done 事件触发两次 sessions.markRead
  clearUnreadLocally: (sessionId) => {
    set((state) => ({ groups: clearUnreadSession(state.groups, sessionId) }))
  },

  setupListeners: () => {
    const refresh = (): void => { void get().load({ silent: true }) }
    const unsubscribers = [
      wsClient.on('session:activity', refresh),
      wsClient.on('session:done', refresh),
      wsClient.on('session:changed', refresh),
      wsClient.on('task:update', refresh),
      wsClient.on('reconnected', refresh),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  },
}))

function clearUnreadSession(groups: MobileActivityGroup[], sessionId: string): MobileActivityGroup[] {
  return groups
    .map((group) => ({
      ...group,
      sessions: group.sessions.flatMap((session) => {
        if (session.sessionId !== sessionId) return [session]
        return session.running ? [{ ...session, unread: false }] : []
      }),
    }))
    .filter((group) => group.sessions.length > 0)
}
