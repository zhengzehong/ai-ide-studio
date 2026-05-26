import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface SessionData {
  id: string; agent_id: string; task_id: string | null; acp_session_id: string | null
  status: string; stage: string; started_at: string; closed_at: string | null
}

export interface MessageData {
  id: string; session_id: string; role: string; content: string
  thinking: string | null; tool_calls_json: string | null; decision_json: string | null; timestamp: string
}

export interface ToolCallInfo {
  id: string; title: string; kind?: string; status?: string
  locations?: { path: string; line?: number }[]
  rawInput?: unknown; rawOutput?: unknown
  content?: { type: string; text?: string; path?: string; oldText?: string; newText?: string }[]
}

export interface UsageInfo { contextSize: number; contextUsed: number; costAmount?: number; costCurrency?: string }
export interface TurnUsageInfo { inputTokens: number; outputTokens: number; totalTokens: number; cachedReadTokens?: number; thoughtTokens?: number }
export interface ModelInfo { modelId: string; name: string; description?: string }
export interface ModeInfo { modeId: string; name: string; description?: string }
export interface PlanEntry { content: string; status: string; priority: string }

export interface SessionCapabilities {
  models: ModelInfo[]; currentModelId: string | null
  modes: ModeInfo[]; currentModeId: string | null
  supportsImages: boolean
}

interface StreamingMessage {
  id: string; role: 'agent'; content: string; thinking: string; toolCalls: ToolCallInfo[]; done: boolean
}

interface SessionCache {
  usage: UsageInfo | null; turnUsage: TurnUsageInfo | null; capabilities: SessionCapabilities; plan: PlanEntry[]
}

interface SessionStore {
  sessions: SessionData[]; currentSessionId: string | null; messages: MessageData[]
  streamingMessage: StreamingMessage | null; usage: UsageInfo | null; turnUsage: TurnUsageInfo | null
  capabilities: SessionCapabilities; plan: PlanEntry[]; loading: boolean

  fetchSessions: (agentId?: string) => Promise<void>
  fetchMessages: (sessionId: string) => Promise<void>
  createSession: (agentId: string, taskId?: string) => Promise<SessionData>
  selectSession: (id: string) => void
  sendPrompt: (content: string, images?: { data: string; mimeType: string }[]) => void
  setModel: (modelId: string) => Promise<void>
  setMode: (modeId: string) => Promise<void>
  fetchModels: () => Promise<void>
  setupListeners: () => () => void
}

let listenersSetup = false
let cleanupFn: (() => void) | null = null
let promptStartTime = 0
const defaultCaps: SessionCapabilities = { models: [], currentModelId: null, modes: [], currentModeId: null, supportsImages: false }
const sessionCaches = new Map<string, SessionCache>()

function saveCache(sessionId: string, s: { usage: UsageInfo | null; turnUsage: TurnUsageInfo | null; capabilities: SessionCapabilities; plan: PlanEntry[] }) {
  sessionCaches.set(sessionId, { usage: s.usage, turnUsage: s.turnUsage, capabilities: { ...s.capabilities }, plan: [...s.plan] })
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [], currentSessionId: null, messages: [], streamingMessage: null,
  usage: null, turnUsage: null, capabilities: { ...defaultCaps }, plan: [], loading: false,

  fetchSessions: async (agentId) => {
    set({ loading: true })
    try {
      const msg: Record<string, unknown> = { type: 'sessions.list' }
      if (agentId) msg.agentId = agentId
      set({ sessions: await wsClient.request(msg) as SessionData[], loading: false })
    } catch { set({ loading: false }) }
  },

  fetchMessages: async (sessionId) => {
    try { set({ messages: await wsClient.request({ type: 'sessions.messages', sessionId }) as MessageData[] }) } catch {}
  },

  createSession: async (agentId, taskId) => {
    const msg: Record<string, unknown> = { type: 'sessions.create', agentId }
    if (taskId) msg.taskId = taskId
    const session = await wsClient.request(msg) as SessionData
    set({ sessions: [...get().sessions, session] })
    return session
  },

  selectSession: (id) => {
    const prev = get().currentSessionId
    if (prev) { saveCache(prev, get()); wsClient.unsubscribe([prev]) }
    wsClient.subscribe([id])
    const c = sessionCaches.get(id)
    set({ currentSessionId: id, messages: [], streamingMessage: null, usage: c?.usage || null, turnUsage: c?.turnUsage || null, capabilities: c?.capabilities || { ...defaultCaps }, plan: c?.plan || [] })
    get().fetchMessages(id)
    get().fetchModels()
  },

  sendPrompt: (content, images) => {
    const sid = get().currentSessionId; if (!sid) return
    const msg: Record<string, unknown> = { type: 'prompt', sessionId: sid, content }
    if (images?.length) msg.images = images
    wsClient.send(msg)
    promptStartTime = Date.now()
    set({ messages: [...get().messages, { id: `msg-local-${Date.now()}`, session_id: sid, role: 'human', content, thinking: null, tool_calls_json: null, decision_json: null, timestamp: new Date().toISOString() }], turnUsage: null })
  },

  setModel: async (modelId) => {
    const sid = get().currentSessionId; if (!sid) return
    try { await wsClient.request({ type: 'session.setModel', sessionId: sid, modelId }); set(s => ({ capabilities: { ...s.capabilities, currentModelId: modelId } })) } catch (e) { console.error('模型切换失败:', e) }
  },

  setMode: async (modeId) => {
    const sid = get().currentSessionId; if (!sid) return
    try { await wsClient.request({ type: 'session.setMode', sessionId: sid, modeId }); set(s => ({ capabilities: { ...s.capabilities, currentModeId: modeId } })) } catch (e) { console.error('模式切换失败:', e) }
  },

  fetchModels: async () => {
    const sid = get().currentSessionId; if (!sid) return
    try {
      const d = await wsClient.request({ type: 'session.getModels', sessionId: sid }) as { models: ModelInfo[]; currentModelId: string | null; modes: ModeInfo[]; currentModeId: string | null; supportsImages: boolean }
      const caps = { models: d.models, currentModelId: d.currentModelId, modes: d.modes || [], currentModeId: d.currentModeId || null, supportsImages: d.supportsImages }
      set({ capabilities: caps }); saveCache(sid, { ...get(), capabilities: caps })
    } catch {}
  },

  setupListeners: () => {
    if (listenersSetup && cleanupFn) return cleanupFn
    const offs: (() => void)[] = []

    offs.push(wsClient.on('session:update', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const data = msg.data as Record<string, unknown>

      if (data.usage) { const u = data.usage as UsageInfo; set({ usage: u }); saveCache(sid, get()); return }
      if (data.plan) { set({ plan: data.plan as PlanEntry[] }); saveCache(sid, get()); return }

      set((state) => {
        const cur = state.streamingMessage
        const up: StreamingMessage = cur ? { ...cur, toolCalls: [...cur.toolCalls] } : { id: `stream-${sid}-${Date.now()}`, role: 'agent', content: '', thinking: '', toolCalls: [], done: false }
        if (data.contentDelta) up.content += data.contentDelta as string
        if (data.thinking) up.thinking += data.thinking as string
        if (data.toolCall) up.toolCalls.push(data.toolCall as ToolCallInfo)
        if (data.toolCallUpdate) {
          const tcu = data.toolCallUpdate as ToolCallInfo
          const idx = up.toolCalls.findIndex(t => t.id === tcu.id)
          if (idx >= 0) up.toolCalls[idx] = { ...up.toolCalls[idx], ...tcu }
          else up.toolCalls.push(tcu)
        }
        return { streamingMessage: up }
      })
    }))

    offs.push(wsClient.on('session:done', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const tu = msg.turnUsage as TurnUsageInfo | undefined
      const cost = get().usage?.costAmount
      const elapsed = promptStartTime > 0 ? Math.round((Date.now() - promptStartTime) / 1000) : undefined
      promptStartTime = 0
      const s = get().streamingMessage
      if (s && (s.content || s.thinking || s.toolCalls.length > 0)) {
        const turnStats = tu ? JSON.stringify({ ...tu, costAmount: cost, elapsedSeconds: elapsed }) : null
        set(st => ({ messages: [...st.messages, { id: s.id, session_id: sid, role: 'agent', content: s.content, thinking: s.thinking || null, tool_calls_json: s.toolCalls.length > 0 ? JSON.stringify(s.toolCalls) : null, decision_json: turnStats, timestamp: new Date().toISOString() }], streamingMessage: null, turnUsage: tu || st.turnUsage }))
      } else { set({ streamingMessage: null, turnUsage: tu || get().turnUsage }) }
      saveCache(sid, get())
    }))

    offs.push(wsClient.on('session:capabilities', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const c = msg.capabilities as Partial<SessionCapabilities>
      set(st => {
        const merged = { models: c.models || st.capabilities.models, currentModelId: c.currentModelId || st.capabilities.currentModelId, modes: c.modes || st.capabilities.modes, currentModeId: c.currentModeId || st.capabilities.currentModeId, supportsImages: c.supportsImages ?? st.capabilities.supportsImages }
        saveCache(sid, { ...st, capabilities: merged })
        return { capabilities: merged }
      })
    }))

    listenersSetup = true
    cleanupFn = () => { offs.forEach(f => f()); listenersSetup = false; cleanupFn = null }
    return cleanupFn
  },
}))
