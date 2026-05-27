import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import {
  buildCompletedAgentMessage,
  capabilitiesFromConfig,
  defaultCaps,
  mergeCapabilities,
  mergeToolCall,
  reduceSessionEvents,
  type AvailableCommandInfo,
  type ConfigOptionInfo,
  type ElicitationRequestInfo,
  type ImageAttachmentInfo,
  type MessageData,
  type ModeInfo,
  type ModelInfo,
  type PermissionRequestInfo,
  type PlanEntry,
  type SessionCapabilities,
  type SessionEventData,
  type StreamingMessage,
  type ToolCallInfo,
  type TurnUsageInfo,
  type UsageInfo,
} from './session-events'

export type {
  AvailableCommandInfo,
  ConfigOptionInfo,
  ElicitationRequestInfo,
  ImageAttachmentInfo,
  MessageData,
  ModeInfo,
  ModelInfo,
  PermissionRequestInfo,
  PlanEntry,
  SessionCapabilities,
  SessionEventData,
  ToolCallInfo,
  TurnUsageInfo,
  UsageInfo,
}

export interface SessionData {
  id: string; agent_id: string; task_id: string | null; acp_session_id: string | null
  status: string; stage: string; started_at: string; closed_at: string | null
}

interface SessionCache {
  events: SessionEventData[]; usage: UsageInfo | null; turnUsage: TurnUsageInfo | null; capabilities: SessionCapabilities; plan: PlanEntry[]
  pendingPermissions: PermissionRequestInfo[]; pendingElicitations: ElicitationRequestInfo[]; streamingMessage: StreamingMessage | null
}

interface SessionStore {
  sessions: SessionData[]; currentSessionId: string | null; messages: MessageData[]; events: SessionEventData[]
  streamingMessage: StreamingMessage | null; usage: UsageInfo | null; turnUsage: TurnUsageInfo | null
  capabilities: SessionCapabilities; plan: PlanEntry[]; pendingPermissions: PermissionRequestInfo[]; pendingElicitations: ElicitationRequestInfo[]; loading: boolean

  fetchSessions: (agentId?: string) => Promise<void>
  fetchMessages: (sessionId: string) => Promise<void>
  fetchEvents: (sessionId: string) => Promise<void>
  createSession: (agentId: string, taskId?: string) => Promise<SessionData>
  selectSession: (id: string) => void
  sendPrompt: (content: string, images?: ImageAttachmentInfo[]) => void
  setModel: (modelId: string) => Promise<void>
  setMode: (modeId: string) => Promise<void>
  setConfig: (configId: string, value: string | boolean) => Promise<void>
  cancelTurn: () => Promise<void>
  respondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  respondElicitation: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => Promise<void>
  fetchModels: () => Promise<void>
  setupListeners: () => () => void
}

let listenersSetup = false
let cleanupFn: (() => void) | null = null
let promptStartTime = 0
let lastStreamingSnapshot: StreamingMessage | null = null
const sessionCaches = new Map<string, SessionCache>()

function saveCache(sessionId: string, s: Pick<SessionStore, 'events' | 'usage' | 'turnUsage' | 'capabilities' | 'plan' | 'pendingPermissions' | 'pendingElicitations' | 'streamingMessage'>) {
  sessionCaches.set(sessionId, {
    events: [...s.events], usage: s.usage, turnUsage: s.turnUsage, capabilities: { ...s.capabilities, models: [...s.capabilities.models], modes: [...s.capabilities.modes], configOptions: [...s.capabilities.configOptions], commands: [...s.capabilities.commands] },
    plan: [...s.plan], pendingPermissions: [...s.pendingPermissions], pendingElicitations: [...s.pendingElicitations], streamingMessage: s.streamingMessage,
  })
}

function applyReduced(set: (partial: Partial<SessionStore>) => void, currentCapabilities: SessionCapabilities, events: SessionEventData[]) {
  const reduced = reduceSessionEvents(events)
  set({
    events,
    streamingMessage: reduced.streamingMessage,
    usage: reduced.usage,
    turnUsage: reduced.turnUsage,
    capabilities: mergeCapabilities(currentCapabilities, reduced.capabilities),
    plan: reduced.plan,
    pendingPermissions: reduced.pendingPermissions,
    pendingElicitations: reduced.pendingElicitations,
  })
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [], currentSessionId: null, messages: [], events: [], streamingMessage: null,
  usage: null, turnUsage: null, capabilities: { ...defaultCaps }, plan: [], pendingPermissions: [], pendingElicitations: [], loading: false,

  fetchSessions: async (agentId) => {
    set({ loading: true })
    try {
      const msg: Record<string, unknown> = { type: 'sessions.list' }
      if (agentId) msg.agentId = agentId
      set({ sessions: await wsClient.request(msg) as SessionData[], loading: false })
    } catch { set({ loading: false }) }
  },

  fetchMessages: async (sessionId) => {
    try { set({ messages: await wsClient.request({ type: 'sessions.messages', sessionId }) as MessageData[] }) } catch { /* ignore message load errors */ }
  },

  fetchEvents: async (sessionId) => {
    try {
      const events = await wsClient.request({ type: 'sessions.events', sessionId, limit: 1000 }) as SessionEventData[]
      if (sessionId !== get().currentSessionId) return
      applyReduced(set, get().capabilities, events)
      saveCache(sessionId, get())
    } catch {
      /* ignore event load errors */
    }
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
    lastStreamingSnapshot = null
    wsClient.subscribe([id])
    const c = sessionCaches.get(id)
    set({
      currentSessionId: id, messages: [], events: c?.events || [], streamingMessage: c?.streamingMessage || null,
      usage: c?.usage || null, turnUsage: c?.turnUsage || null, capabilities: c?.capabilities || { ...defaultCaps }, plan: c?.plan || [],
      pendingPermissions: c?.pendingPermissions || [], pendingElicitations: c?.pendingElicitations || [],
    })
    void get().fetchMessages(id)
    void get().fetchEvents(id)
    void get().fetchModels()
  },

  sendPrompt: (content, images) => {
    const sid = get().currentSessionId; if (!sid) return
    const msg: Record<string, unknown> = { type: 'prompt', sessionId: sid, content }
    if (images?.length) msg.images = images
    wsClient.send(msg)
    promptStartTime = Date.now()
    set({ messages: [...get().messages, { id: `msg-local-${Date.now()}`, session_id: sid, role: 'human', content, thinking: null, tool_calls_json: null, decision_json: null, attachments_json: images?.length ? JSON.stringify(images) : null, timestamp: new Date().toISOString() }], turnUsage: null })
  },

  setModel: async (modelId) => {
    const sid = get().currentSessionId; if (!sid) return
    try { await wsClient.request({ type: 'session.setModel', sessionId: sid, modelId }); set(s => ({ capabilities: { ...s.capabilities, currentModelId: modelId } })) } catch (e) { console.error('模型切换失败:', e) }
  },

  setMode: async (modeId) => {
    const sid = get().currentSessionId; if (!sid) return
    try { await wsClient.request({ type: 'session.setMode', sessionId: sid, modeId }); set(s => ({ capabilities: { ...s.capabilities, currentModeId: modeId } })) } catch (e) { console.error('模式切换失败:', e) }
  },

  setConfig: async (configId, value) => {
    const sid = get().currentSessionId; if (!sid) return
    try { await wsClient.request({ type: 'session.setConfig', sessionId: sid, configId, value }) } catch (e) { console.error('配置切换失败:', e) }
  },

  cancelTurn: async () => {
    const sid = get().currentSessionId; if (!sid) return
    try { await wsClient.request({ type: 'session.cancel', sessionId: sid }) } catch (e) { console.error('取消失败:', e) }
  },

  respondPermission: async (requestId, optionId, cancelled) => {
    const sid = get().currentSessionId; if (!sid) return
    await wsClient.request({ type: 'permission.respond', sessionId: sid, permissionRequestId: requestId, optionId, cancelled })
  },

  respondElicitation: async (requestId, action, content) => {
    const sid = get().currentSessionId; if (!sid) return
    await wsClient.request({ type: 'elicitation.respond', sessionId: sid, elicitationRequestId: requestId, action, content })
  },

  fetchModels: async () => {
    const sid = get().currentSessionId; if (!sid) return
    try {
      const d = await wsClient.request({ type: 'session.getModels', sessionId: sid }) as Partial<SessionCapabilities>
      const caps = {
        ...get().capabilities,
        models: d.models || get().capabilities.models, currentModelId: d.currentModelId || get().capabilities.currentModelId,
        modes: d.modes || get().capabilities.modes, currentModeId: d.currentModeId || get().capabilities.currentModeId,
        supportsImages: d.supportsImages ?? get().capabilities.supportsImages,
        supportsAudio: d.supportsAudio ?? get().capabilities.supportsAudio,
        configOptions: d.configOptions || get().capabilities.configOptions,
        commands: d.commands || get().capabilities.commands,
        sessionInfo: d.sessionInfo || get().capabilities.sessionInfo,
      }
      set({ capabilities: caps }); saveCache(sid, { ...get(), capabilities: caps })
    } catch {
      /* ignore model load errors */
    }
  },

  setupListeners: () => {
    if (listenersSetup && cleanupFn) return cleanupFn
    const offs: (() => void)[] = []

    offs.push(wsClient.on('session:event', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const event = msg.event as SessionEventData
      const events = [...get().events.filter(e => e.id !== event.id), event].sort((a, b) => a.sequence - b.sequence)
      const activeStreaming = get().streamingMessage
      applyReduced(set, get().capabilities, events)
      if (activeStreaming && (activeStreaming.content || activeStreaming.thinking || activeStreaming.toolCalls.length > 0)) {
        lastStreamingSnapshot = activeStreaming
        if (!get().streamingMessage) {
          set({ streamingMessage: activeStreaming })
        }
      }
      saveCache(sid, get())
    }))

    offs.push(wsClient.on('session:update', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const data = msg.data as Record<string, unknown>

      if (data.usage) { const u = data.usage as UsageInfo; set({ usage: u }); saveCache(sid, get()); return }
      if (data.plan) { set({ plan: data.plan as PlanEntry[] }); saveCache(sid, get()); return }
      if (data.configOptions) { set(s => ({ capabilities: capabilitiesFromConfig(s.capabilities, data.configOptions as ConfigOptionInfo[]) })); saveCache(sid, get()); return }
      if (data.commands) { set(s => ({ capabilities: { ...s.capabilities, commands: data.commands as AvailableCommandInfo[] } })); saveCache(sid, get()); return }
      if (data.permissionRequest) { const req = data.permissionRequest as PermissionRequestInfo; set(s => ({ pendingPermissions: [...s.pendingPermissions.filter(p => p.id !== req.id), req] })); saveCache(sid, get()); return }
      if (data.elicitationRequest) { const req = data.elicitationRequest as ElicitationRequestInfo; set(s => ({ pendingElicitations: [...s.pendingElicitations.filter(p => p.id !== req.id), req] })); saveCache(sid, get()); return }

      set((state) => {
        const cur = state.streamingMessage
        const up: StreamingMessage = cur ? { ...cur, toolCalls: [...cur.toolCalls] } : { id: String(data.messageId || `stream-${sid}-${Date.now()}`), role: 'agent', content: '', thinking: '', toolCalls: [], done: false }
        if (data.contentDelta) up.content += data.contentDelta as string
        if (data.thinking) up.thinking += data.thinking as string
        if (data.toolCall) up.toolCalls.push(data.toolCall as ToolCallInfo)
        if (data.toolCallUpdate) {
          const tcu = data.toolCallUpdate as ToolCallInfo
          const idx = up.toolCalls.findIndex(t => t.id === tcu.id)
          if (idx >= 0) up.toolCalls[idx] = mergeToolCall(up.toolCalls[idx], tcu)
          else up.toolCalls.push(tcu)
        }
        lastStreamingSnapshot = up
        return { streamingMessage: up }
      })
    }))

    offs.push(wsClient.on('session:done', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const tu = msg.turnUsage as TurnUsageInfo | undefined
      const cost = get().usage?.costAmount
      const elapsed = promptStartTime > 0 ? Math.round((Date.now() - promptStartTime) / 1000) : undefined
      promptStartTime = 0

      const s = get().streamingMessage || lastStreamingSnapshot
      lastStreamingSnapshot = null

      const turnStats = tu ? JSON.stringify({ ...tu, costAmount: cost, elapsedSeconds: elapsed }) : null

      if (s && (s.content || s.thinking || s.toolCalls.length > 0)) {
        const finalizedToolCalls = s.toolCalls.map(tc =>
          (tc.status === 'pending' || tc.status === 'in_progress') ? { ...tc, status: 'completed' } : tc
        )
        const newMsg: MessageData = {
          id: s.id, session_id: sid, role: 'agent', content: s.content,
          thinking: s.thinking || null,
          tool_calls_json: finalizedToolCalls.length > 0 ? JSON.stringify(finalizedToolCalls) : null,
          decision_json: turnStats, attachments_json: null,
          timestamp: new Date().toISOString(),
        }
        set(st => ({
          messages: [...st.messages.filter(m => m.id !== newMsg.id), newMsg],
          streamingMessage: null, turnUsage: tu || st.turnUsage,
        }))
      } else {
        const finalMessage = buildCompletedAgentMessage(sid, get().events, tu, cost, elapsed)
        if (finalMessage) {
          if (turnStats && !finalMessage.decision_json) finalMessage.decision_json = turnStats
          set(st => ({
            messages: [...st.messages.filter(m => m.id !== finalMessage.id), finalMessage],
            streamingMessage: null, turnUsage: tu || st.turnUsage,
          }))
        } else {
          set({ streamingMessage: null, turnUsage: tu || get().turnUsage })
        }
      }
      saveCache(sid, get())
    }))

    offs.push(wsClient.on('session:capabilities', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const c = msg.capabilities as Partial<SessionCapabilities>
      set(st => {
        const merged = {
          ...st.capabilities,
          models: c.models || st.capabilities.models, currentModelId: c.currentModelId || st.capabilities.currentModelId,
          modes: c.modes || st.capabilities.modes, currentModeId: c.currentModeId || st.capabilities.currentModeId,
          supportsImages: c.supportsImages ?? st.capabilities.supportsImages, supportsAudio: c.supportsAudio ?? st.capabilities.supportsAudio,
          configOptions: c.configOptions || st.capabilities.configOptions, commands: c.commands || st.capabilities.commands, sessionInfo: c.sessionInfo || st.capabilities.sessionInfo,
        }
        saveCache(sid, { ...st, capabilities: merged })
        return { capabilities: merged }
      })
    }))

    listenersSetup = true
    cleanupFn = () => { offs.forEach(f => f()); listenersSetup = false; cleanupFn = null }
    return cleanupFn
  },
}))
