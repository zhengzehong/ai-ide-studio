import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import {
  applySessionEvent,
  buildErrorAgentMessage,
  buildChatTimelineFromEvents,
  buildCompletedAgentMessage,
  capabilitiesFromConfig,
  defaultCaps,
  finalizePlanOnTurnDone,
  groupChatTimelineItems,
  appendFinalizedMessage,
  mergeCapabilities,
  mergeMessagesForSession,
  normalizeMessage,
  shouldCreateToolFromUpdate,
  upsertToolCall,
  reduceSessionEvents,
  shouldShowLifecycleStage,
  type AvailableCommandInfo,
  type ChatTimelineItem,
  type ChatTimelineGroup,
  type ChatTimelineMessageItem,
  type ChatTimelineToolItem,
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
  type ToolCallDetailInfo,
  type ToolCallInfo,
  type ToolCallSummaryInfo,
  type TurnUsageInfo,
  type UsageInfo,
} from './session-events'
import { StreamingBuffer } from './streaming-buffer'

export type {
  AvailableCommandInfo,
  ChatTimelineItem,
  ChatTimelineGroup,
  ChatTimelineMessageItem,
  ChatTimelineToolItem,
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
  ToolCallDetailInfo,
  ToolCallInfo,
  ToolCallSummaryInfo,
  TurnUsageInfo,
  UsageInfo,
}

export { buildChatTimelineFromEvents, groupChatTimelineItems }

export interface SessionData {
  id: string; agent_id: string; task_id: string | null; acp_session_id: string | null
  status: string; stage: string; started_at: string; closed_at: string | null
  project_id?: string | null; title?: string | null; updated_at?: string | null; last_message_at?: string | null; archived_at?: string | null; deleted_at?: string | null
}

interface SessionCache {
  events: SessionEventData[]; usage: UsageInfo | null; turnUsage: TurnUsageInfo | null; capabilities: SessionCapabilities; plan: PlanEntry[]
  pendingPermissions: PermissionRequestInfo[]; pendingElicitations: ElicitationRequestInfo[]; streamingMessage: StreamingMessage | null
}

interface SessionStore {
  sessions: SessionData[]; currentSessionId: string | null; messages: MessageData[]; events: SessionEventData[]
  streamingMessage: StreamingMessage | null; usage: UsageInfo | null; turnUsage: TurnUsageInfo | null
  capabilities: SessionCapabilities; plan: PlanEntry[]; pendingPermissions: PermissionRequestInfo[]; pendingElicitations: ElicitationRequestInfo[]; loading: boolean
  toolCallSummariesByMessageId: Record<string, ToolCallSummaryInfo[]>
  toolCallDetailsByKey: Record<string, ToolCallDetailInfo>
  toolCallLoadingByKey: Record<string, boolean>
  toolCallErrorByKey: Record<string, string>

  fetchSessions: (agentId?: string, projectId?: string) => Promise<void>
  fetchMessages: (sessionId: string) => Promise<void>
  fetchEvents: (sessionId: string) => Promise<void>
  createSession: (agentId: string, taskId?: string, projectId?: string) => Promise<SessionData>
  renameSession: (sessionId: string, title: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  closeSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  selectSession: (id: string | null) => void
  sendPrompt: (content: string, images?: ImageAttachmentInfo[]) => void
  setModel: (modelId: string) => Promise<void>
  setMode: (modeId: string) => Promise<void>
  setConfig: (configId: string, value: string | boolean) => Promise<void>
  cancelTurn: () => Promise<void>
  respondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  respondElicitation: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => Promise<void>
  fetchModels: () => Promise<void>
  fetchMessageToolCalls: (sessionId: string, messageId: string) => Promise<void>
  fetchMessageToolCallDetail: (sessionId: string, messageId: string, toolCallId: string) => Promise<void>
  setupListeners: () => () => void
}

let listenersSetup = false
let cleanupFn: (() => void) | null = null
let promptStartTime = 0
let lastStreamingSnapshot: StreamingMessage | null = null
let sessionListRequestSeq = 0
let activeSessionsProjectId: string | null = null
const sessionCaches = new Map<string, SessionCache>()
const eventCursorBySession = new Map<string, number>()
const streamingBuffer = new StreamingBuffer()
let streamingFlushTimer: ReturnType<typeof setTimeout> | null = null
const mirroredRealtimeEventTypes = new Set(['message.chunk', 'thinking.chunk', 'tool.call', 'tool.update', 'message.done'])

function saveCache(sessionId: string, s: Pick<SessionStore, 'events' | 'usage' | 'turnUsage' | 'capabilities' | 'plan' | 'pendingPermissions' | 'pendingElicitations' | 'streamingMessage'>) {
  sessionCaches.set(sessionId, {
    events: [...s.events], usage: s.usage, turnUsage: s.turnUsage, capabilities: { ...s.capabilities, models: [...s.capabilities.models], modes: [...s.capabilities.modes], configOptions: [...s.capabilities.configOptions], commands: [...s.capabilities.commands] },
    plan: [...s.plan], pendingPermissions: [...s.pendingPermissions], pendingElicitations: [...s.pendingElicitations], streamingMessage: s.streamingMessage,
  })
}

function reducedStateFromStore(state: SessionStore) {
  return {
    streamingMessage: state.streamingMessage,
    usage: state.usage,
    turnUsage: state.turnUsage,
    capabilities: state.capabilities,
    plan: state.plan,
    pendingPermissions: state.pendingPermissions,
    pendingElicitations: state.pendingElicitations,
  }
}

function partialFromReduced(reduced: ReturnType<typeof reducedStateFromStore>): Partial<SessionStore> {
  return {
    streamingMessage: reduced.streamingMessage,
    usage: reduced.usage,
    turnUsage: reduced.turnUsage,
    capabilities: reduced.capabilities,
    plan: reduced.plan,
    pendingPermissions: reduced.pendingPermissions,
    pendingElicitations: reduced.pendingElicitations,
  }
}

function toolDetailCacheKey(messageId: string, toolCallId: string): string {
  return `${messageId}:${toolCallId}`
}

function flushStreamingBuffer(set: (partial: Partial<SessionStore> | ((state: SessionStore) => Partial<SessionStore>)) => void, get: () => SessionStore): void {
  if (streamingFlushTimer) {
    clearTimeout(streamingFlushTimer)
    streamingFlushTimer = null
  }
  const snapshot = streamingBuffer.flush()
  if (!snapshot) return
  const sid = get().currentSessionId
  set((state) => {
    const cur = state.streamingMessage
    const up: StreamingMessage = cur ? { ...cur, toolCalls: [...cur.toolCalls] } : { id: String(snapshot.messageId || `stream-${sid}-${Date.now()}`), role: 'agent', content: '', thinking: '', toolCalls: [], done: false }
    if (snapshot.messageId && up.id.startsWith('pending-')) up.id = snapshot.messageId
    if (snapshot.contentDelta) { up.content += snapshot.contentDelta; up.stage = undefined }
    if (snapshot.thinking) { up.thinking += snapshot.thinking; up.stage = undefined }
    for (const toolCall of snapshot.toolCalls) { up.toolCalls.push(toolCall); up.stage = undefined }
    for (const update of snapshot.toolCallUpdates) {
      if (!up.toolCalls.some((tool) => tool.id === update.id) && !shouldCreateToolFromUpdate(update)) continue
      up.toolCalls = upsertToolCall(up.toolCalls, update)
      up.stage = undefined
    }
    lastStreamingSnapshot = up
    return { streamingMessage: up }
  })
  const currentSessionId = get().currentSessionId
  if (currentSessionId) saveCache(currentSessionId, get())
}

function scheduleStreamingFlush(set: (partial: Partial<SessionStore> | ((state: SessionStore) => Partial<SessionStore>)) => void, get: () => SessionStore): void {
  if (streamingFlushTimer) return
  streamingFlushTimer = setTimeout(() => {
    streamingFlushTimer = null
    flushStreamingBuffer(set, get)
  }, 50)
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [], currentSessionId: null, messages: [], events: [], streamingMessage: null,
  usage: null, turnUsage: null, capabilities: { ...defaultCaps }, plan: [], pendingPermissions: [], pendingElicitations: [], loading: false,
  toolCallSummariesByMessageId: {}, toolCallDetailsByKey: {}, toolCallLoadingByKey: {}, toolCallErrorByKey: {},

  fetchSessions: async (agentId, projectId) => {
    const requestSeq = ++sessionListRequestSeq
    const scopedProjectId = projectId ?? null
    activeSessionsProjectId = scopedProjectId
    set({ loading: true })
    try {
      const msg: Record<string, unknown> = { type: 'sessions.list' }
      if (agentId) msg.agentId = agentId
      if (projectId) msg.projectId = projectId
      const data = await wsClient.request(msg) as SessionData[]
      if (requestSeq !== sessionListRequestSeq || activeSessionsProjectId !== scopedProjectId) return
      set({
        sessions: scopedProjectId ? data.filter((session) => session.project_id === scopedProjectId) : data,
        loading: false,
      })
    } catch {
      if (requestSeq === sessionListRequestSeq) set({ loading: false })
    }
  },

  fetchMessages: async (sessionId) => {
    try {
      const serverMessages = await wsClient.request({ type: 'sessions.messages', sessionId }) as MessageData[]
      if (sessionId !== get().currentSessionId) return
      set(state => ({ messages: mergeMessagesForSession(serverMessages, state.messages, sessionId) }))
    } catch { /* ignore message load errors */ }
  },

  fetchEvents: async (sessionId) => {
    try {
      const events = await wsClient.request({ type: 'sessions.events', sessionId, limit: 1000 }) as SessionEventData[]
      if (sessionId !== get().currentSessionId) return
      eventCursorBySession.set(sessionId, events.at(-1)?.sequence ?? 0)
      const stateBeforeRecovery = get()
      const recoveryEvents = stateBeforeRecovery.messages.length > 0
        ? events.filter((event) => !mirroredRealtimeEventTypes.has(event.type))
        : events
      const reduced = reduceSessionEvents(recoveryEvents)
      set((state) => ({
        events,
        usage: reduced.usage,
        turnUsage: reduced.turnUsage,
        capabilities: mergeCapabilities(state.capabilities, reduced.capabilities),
        plan: reduced.plan,
        pendingPermissions: reduced.pendingPermissions,
        pendingElicitations: reduced.pendingElicitations,
        streamingMessage: stateBeforeRecovery.messages.length > 0 ? state.streamingMessage : reduced.streamingMessage,
      }))
      saveCache(sessionId, get())
    } catch {
      /* ignore event load errors */
    }
  },

  createSession: async (agentId, taskId, projectId) => {
    const msg: Record<string, unknown> = { type: 'sessions.create', agentId }
    if (taskId) msg.taskId = taskId
    if (projectId) msg.projectId = projectId
    const session = await wsClient.request(msg) as SessionData
    if (!activeSessionsProjectId || session.project_id === activeSessionsProjectId) {
      set({ sessions: [...get().sessions.filter((s) => s.id !== session.id), session] })
    }
    return session
  },

  renameSession: async (sessionId, title) => {
    const session = await wsClient.request({ type: 'sessions.rename', sessionId, title }) as SessionData
    set({ sessions: get().sessions.map(s => s.id === sessionId ? { ...s, ...session } : s) })
  },

  deleteSession: async (sessionId) => {
    await wsClient.request({ type: 'sessions.delete', sessionId })
    sessionCaches.delete(sessionId)
    const currentSessionId = get().currentSessionId === sessionId ? null : get().currentSessionId
    set({
      sessions: get().sessions.filter(s => s.id !== sessionId),
      currentSessionId,
      messages: currentSessionId ? get().messages : [],
      events: currentSessionId ? get().events : [],
      streamingMessage: currentSessionId ? get().streamingMessage : null,
      toolCallSummariesByMessageId: currentSessionId ? get().toolCallSummariesByMessageId : {},
      toolCallDetailsByKey: currentSessionId ? get().toolCallDetailsByKey : {},
      toolCallLoadingByKey: currentSessionId ? get().toolCallLoadingByKey : {},
      toolCallErrorByKey: currentSessionId ? get().toolCallErrorByKey : {},
    })
  },

  closeSession: async (sessionId) => {
    const session = await wsClient.request({ type: 'sessions.close', sessionId }) as SessionData
    set({ sessions: get().sessions.map(s => s.id === sessionId ? { ...s, ...session } : s) })
  },

  archiveSession: async (sessionId) => {
    const session = await wsClient.request({ type: 'sessions.archive', sessionId }) as SessionData
    set({ sessions: get().sessions.map(s => s.id === sessionId ? { ...s, ...session } : s) })
  },

  selectSession: (id) => {
    const prev = get().currentSessionId
    if (prev) { saveCache(prev, get()); wsClient.unsubscribe([prev]) }
    lastStreamingSnapshot = null
    if (!id) {
      set({
        currentSessionId: null,
        messages: [],
        events: [],
        streamingMessage: null,
        usage: null,
        turnUsage: null,
        capabilities: { ...defaultCaps },
        plan: [],
        pendingPermissions: [],
        pendingElicitations: [],
        toolCallSummariesByMessageId: {},
        toolCallDetailsByKey: {},
        toolCallLoadingByKey: {},
        toolCallErrorByKey: {},
      })
      return
    }
    wsClient.subscribe([id])
    const c = sessionCaches.get(id)
    streamingBuffer.clear()
    if (streamingFlushTimer) { clearTimeout(streamingFlushTimer); streamingFlushTimer = null }
    set({
      currentSessionId: id, messages: [], events: c?.events || [], streamingMessage: c?.streamingMessage || null,
      usage: c?.usage || null, turnUsage: c?.turnUsage || null, capabilities: c?.capabilities || { ...defaultCaps }, plan: c?.plan || [],
      pendingPermissions: c?.pendingPermissions || [], pendingElicitations: c?.pendingElicitations || [],
      toolCallSummariesByMessageId: {}, toolCallDetailsByKey: {}, toolCallLoadingByKey: {}, toolCallErrorByKey: {},
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
    set({
      messages: [...get().messages, normalizeMessage({ id: `msg-local-${Date.now()}`, session_id: sid, role: 'human', content, thinking: null, tool_calls_json: null, decision_json: null, attachments_json: images?.length ? JSON.stringify(images) : null, timestamp: new Date().toISOString() })],
      streamingMessage: { id: `pending-${sid}-${Date.now()}`, role: 'agent', content: '', thinking: '', toolCalls: [], done: false, stage: '\u6b63\u5728\u51c6\u5907 Agent...' },
      turnUsage: null,
    })
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

  fetchMessageToolCalls: async (sessionId, messageId) => {
    if (get().toolCallSummariesByMessageId[messageId]) return
    set((state) => ({
      toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [messageId]: true },
      toolCallErrorByKey: { ...state.toolCallErrorByKey, [messageId]: '' },
    }))
    try {
      const summaries = await wsClient.request({ type: 'sessions.messageToolCalls', sessionId, messageId }) as ToolCallSummaryInfo[]
      if (sessionId !== get().currentSessionId) return
      set((state) => ({
        toolCallSummariesByMessageId: { ...state.toolCallSummariesByMessageId, [messageId]: summaries },
        toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [messageId]: false },
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((state) => ({
        toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [messageId]: false },
        toolCallErrorByKey: { ...state.toolCallErrorByKey, [messageId]: message },
      }))
    }
  },

  fetchMessageToolCallDetail: async (sessionId, messageId, toolCallId) => {
    const key = toolDetailCacheKey(messageId, toolCallId)
    if (get().toolCallDetailsByKey[key]) return
    set((state) => ({
      toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [key]: true },
      toolCallErrorByKey: { ...state.toolCallErrorByKey, [key]: '' },
    }))
    try {
      const detail = await wsClient.request({ type: 'sessions.messageToolCallDetail', sessionId, messageId, toolCallId }) as ToolCallDetailInfo
      if (sessionId !== get().currentSessionId) return
      set((state) => ({
        toolCallDetailsByKey: { ...state.toolCallDetailsByKey, [key]: detail },
        toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [key]: false },
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((state) => ({
        toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [key]: false },
        toolCallErrorByKey: { ...state.toolCallErrorByKey, [key]: message },
      }))
    }
  },

  setupListeners: () => {
    if (listenersSetup && cleanupFn) return cleanupFn
    const offs: (() => void)[] = []

    offs.push(wsClient.on('session:event', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const event = msg.event as SessionEventData
      eventCursorBySession.set(sid, Math.max(eventCursorBySession.get(sid) ?? 0, event.sequence))
      const shouldApplyToVisibleState = !mirroredRealtimeEventTypes.has(event.type)
      if (!shouldApplyToVisibleState) return
      set((state) => {
        const events = [...state.events.filter(e => e.id !== event.id), event]
          .sort((a, b) => a.sequence - b.sequence)
          .slice(-1000)
        const reduced = applySessionEvent(reducedStateFromStore(state), event)
        return { events, ...partialFromReduced(reduced) }
      })
      saveCache(sid, get())
    }))

    offs.push(wsClient.on('session:update', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const data = msg.data as Record<string, unknown>

      if (typeof data.eventType === 'string' && data.eventType.startsWith('lifecycle.')) {
        if (!shouldShowLifecycleStage(data.eventType)) {
          set((state) => {
            const cur = state.streamingMessage
            if (!cur || cur.content || cur.thinking || cur.toolCalls.length > 0) return {}
            return { streamingMessage: null }
          })
          saveCache(sid, get())
          return
        }
        const stage = String(data.content || '')
        set((state) => {
          const cur = state.streamingMessage
          const up: StreamingMessage = cur ? { ...cur, toolCalls: [...cur.toolCalls] } : { id: String(data.messageId || `stream-${sid}-${Date.now()}`), role: 'agent', content: '', thinking: '', toolCalls: [], done: false }
          up.stage = stage
          return { streamingMessage: up }
        })
        saveCache(sid, get())
        return
      }
      if (data.eventType === 'permission.result' || data.eventType === 'elicitation.result') return
      if (data.usage) { const u = data.usage as UsageInfo; set({ usage: u }); saveCache(sid, get()); return }
      if (data.plan) { set({ plan: data.plan as PlanEntry[] }); saveCache(sid, get()); return }
      if (data.configOptions) { set(s => ({ capabilities: capabilitiesFromConfig(s.capabilities, data.configOptions as ConfigOptionInfo[]) })); saveCache(sid, get()); return }
      if (data.commands) { set(s => ({ capabilities: { ...s.capabilities, commands: data.commands as AvailableCommandInfo[] } })); saveCache(sid, get()); return }
      if (data.permissionRequest) { const req = data.permissionRequest as PermissionRequestInfo; set(s => ({ pendingPermissions: [...s.pendingPermissions.filter(p => p.id !== req.id), req] })); saveCache(sid, get()); return }
      if (data.elicitationRequest) { const req = data.elicitationRequest as ElicitationRequestInfo; set(s => ({ pendingElicitations: [...s.pendingElicitations.filter(p => p.id !== req.id), req] })); saveCache(sid, get()); return }

      if (data.contentDelta || data.thinking || data.toolCall || data.toolCallUpdate) {
        streamingBuffer.push({
          messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
          contentDelta: typeof data.contentDelta === 'string' ? data.contentDelta : undefined,
          thinking: typeof data.thinking === 'string' ? data.thinking : undefined,
          toolCall: data.toolCall as ToolCallInfo | undefined,
          toolCallUpdate: data.toolCallUpdate as ToolCallInfo | undefined,
        })
        scheduleStreamingFlush(set, get)
      }
    }))

    offs.push(wsClient.on('session:done', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      flushStreamingBuffer(set, get)
      const tu = msg.turnUsage as TurnUsageInfo | undefined
      const stopReason = msg.stopReason as string | undefined
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
          messages: appendFinalizedMessage(st.messages, newMsg),
          streamingMessage: null, turnUsage: tu || st.turnUsage, plan: finalizePlanOnTurnDone(st.plan, stopReason),
        }))
      } else {
        const error = typeof msg.error === 'string' ? msg.error : ''
        const finalMessage = error
          ? buildErrorAgentMessage(sid, String(msg.messageId || `error-${Date.now()}`), error)
          : buildCompletedAgentMessage(sid, get().events, tu, cost, elapsed)
        if (finalMessage) {
          if (turnStats && !finalMessage.decision_json) finalMessage.decision_json = turnStats
          set(st => ({
            messages: appendFinalizedMessage(st.messages, finalMessage),
            streamingMessage: null, turnUsage: tu || st.turnUsage, plan: finalizePlanOnTurnDone(st.plan, stopReason),
          }))
        } else {
          set(st => ({
            streamingMessage: null,
            turnUsage: tu || st.turnUsage,
            plan: finalizePlanOnTurnDone(st.plan, stopReason),
          }))
        }
      }
      saveCache(sid, get())
      void get().fetchEvents(sid)
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

    offs.push(wsClient.on('session:changed', (msg) => {
      const sessionId = msg.sessionId as string
      const data = msg.data as Partial<SessionData> & { event?: string; deleted?: boolean }
      if (data.deleted || data.event === 'deleted') {
        sessionCaches.delete(sessionId)
        set(st => ({
          sessions: st.sessions.filter(s => s.id !== sessionId),
          currentSessionId: st.currentSessionId === sessionId ? null : st.currentSessionId,
          messages: st.currentSessionId === sessionId ? [] : st.messages,
          events: st.currentSessionId === sessionId ? [] : st.events,
          streamingMessage: st.currentSessionId === sessionId ? null : st.streamingMessage,
        }))
        return
      }
      set(st => {
        const incomingProjectId = data.project_id as string | null | undefined
        const inCurrentScope = !activeSessionsProjectId || incomingProjectId === undefined || incomingProjectId === activeSessionsProjectId
        if (!inCurrentScope) return { sessions: st.sessions.filter(s => s.id !== sessionId) }
        if (st.sessions.some(s => s.id === sessionId)) {
          return { sessions: st.sessions.map(s => s.id === sessionId ? { ...s, ...data } : s) }
        }
        if (isCompleteSessionData(data, sessionId) && (!activeSessionsProjectId || data.project_id === activeSessionsProjectId)) {
          return { sessions: [...st.sessions, data] }
        }
        return { sessions: st.sessions }
      })
    }))

    listenersSetup = true
    cleanupFn = () => { offs.forEach(f => f()); listenersSetup = false; cleanupFn = null }
    return cleanupFn
  },
}))

function isCompleteSessionData(data: Partial<SessionData>, sessionId: string): data is SessionData {
  return data.id === sessionId &&
    typeof data.agent_id === 'string' &&
    typeof data.status === 'string' &&
    typeof data.stage === 'string' &&
    typeof data.started_at === 'string' &&
    (data.task_id === null || typeof data.task_id === 'string') &&
    (data.acp_session_id === null || typeof data.acp_session_id === 'string') &&
    (data.closed_at === null || typeof data.closed_at === 'string') &&
    (data.project_id === undefined || data.project_id === null || typeof data.project_id === 'string')
}
