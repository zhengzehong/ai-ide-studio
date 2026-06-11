import { create } from 'zustand'
import { wsClient } from '@desktop/services/ws-client'
import type {
  MessageData,
  ToolCallInfo,
  PermissionRequestInfo,
  ElicitationRequestInfo,
  PlanEntry,
  SessionEventData,
  ImageAttachmentInfo,
  TurnUsageInfo,
  UsageInfo,
  TurnProcessItemInfo,
  ConfigOptionInfo,
  AvailableCommandInfo,
} from '@desktop/stores/session-events'
import {
  normalizeMessage,
  reduceSessionEvents,
  applySessionEvent,
  mergeCapabilities,
  capabilitiesFromConfig,
  buildErrorAgentMessage,
  buildCompletedAgentMessage,
  appendFinalizedMessage,
  clearPlanOnTurnDone,
  defaultCaps,
  shouldShowLifecycleStage,
  shouldCreateToolFromUpdate,
  type SessionCapabilities,
  type StreamingMessage,
  mergeMessagesForSession,
} from '@desktop/stores/session-events'
import { StreamingBuffer } from '@desktop/stores/streaming-buffer'
import {
  applyTurnEntry,
  createEmptyTurn,
  processBlocksForCompletedTurn,
  turnFromEvents,
  turnFromProcessItems,
  turnHasFinalizableContent,
  turnHasVisibleContent,
  type TurnProcessBlock,
} from '@desktop/stores/turn-blocks'

interface ChatState {
  sessionId: string | null
  messages: MessageData[]
  events: SessionEventData[]
  streamingMessage: StreamingMessage | null
  plan: PlanEntry[]
  pendingPermissions: PermissionRequestInfo[]
  pendingElicitations: ElicitationRequestInfo[]
  capabilities: SessionCapabilities
  usage: UsageInfo | null
  turnUsage: TurnUsageInfo | null
  loading: boolean
  isRunning: boolean
  turnProcessLoadingByMessageId: Record<string, boolean>
  turnProcessErrorByMessageId: Record<string, string>

  enterSession: (sessionId: string) => void
  leaveSession: () => void
  sendPrompt: (content: string, images?: ImageAttachmentInfo[]) => void
  fetchMessageProcess: (sessionId: string, messageId: string) => Promise<void>
  cancelTurn: () => Promise<void>
  respondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  respondElicitation: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => Promise<void>
  setupListeners: () => () => void
}

const streamingBuffer = new StreamingBuffer()
let streamingFlushTimer: ReturnType<typeof setTimeout> | null = null
let promptStartTime = 0
let lastStreamingSnapshot: StreamingMessage | null = null
const mirroredRealtimeEventTypes = new Set(['message.chunk', 'thinking.chunk', 'tool.call', 'tool.update', 'message.done'])

function timestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeActiveTurn(message: StreamingMessage | null | undefined): StreamingMessage | null {
  if (!message) return null
  if (Array.isArray(message.processBlocks)) return message
  let next = createEmptyTurn(message.id)
  if (message.stage) next = applyTurnEntry(next, { kind: 'stage', text: message.stage })
  if (message.thinking) next = applyTurnEntry(next, { kind: 'thinking', text: message.thinking })
  for (const tc of message.toolCalls ?? []) next = applyTurnEntry(next, { kind: 'toolCall', toolCall: tc })
  if (message.content) next = applyTurnEntry(next, { kind: 'reply', text: message.content })
  if (message.done) next = applyTurnEntry(next, { kind: 'done' })
  return next
}

function mergeProcessBlock(blocks: TurnProcessBlock[], block: TurnProcessBlock): TurnProcessBlock[] {
  const next = blocks.filter((item) => {
    if (item.id === block.id) return false
    if (block.kind === 'stage') return item.kind !== 'stage'
    if (block.kind === 'tool' && item.kind === 'tool') return item.toolCall.id !== block.toolCall.id
    if (block.kind === 'note' && item.kind === 'note') return item.text !== block.text
    return true
  })
  next.push(block)
  return next.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
}

function mergeProcessBlockIntoStreaming(turn: StreamingMessage, block: TurnProcessBlock): StreamingMessage {
  const base = normalizeActiveTurn(turn) ?? createEmptyTurn(turn.id)
  const next: StreamingMessage = { ...base, processBlocks: mergeProcessBlock(base.processBlocks, block) }
  next.thinking = next.processBlocks.filter((b): b is Extract<TurnProcessBlock, { kind: 'thinking' }> => b.kind === 'thinking').map(b => b.text).join('')
  next.toolCalls = next.processBlocks.filter((b): b is Extract<TurnProcessBlock, { kind: 'tool' }> => b.kind === 'tool').map(b => b.toolCall)
  if (block.kind === 'note' && next.finalAnswer) {
    next.finalAnswer = ''
    next.content = ''
  }
  if (block.kind === 'stage') { next.stage = block.text } else { next.stage = undefined }
  return next
}

function streamingBaseForProcessItem(
  current: StreamingMessage | null,
  item: TurnProcessItemInfo,
  isSessionRunning: boolean,
): StreamingMessage | null {
  const normalized = normalizeActiveTurn(current)
  if (normalized?.id === item.message_id) return normalized
  if (!isSessionRunning) return normalized

  const canHandoff =
    !normalized ||
    normalized.id.startsWith('pending-') ||
    (!!normalized.stage && !normalized.finalAnswer && normalized.processBlocks.every((block) => block.kind === 'stage'))

  if (!canHandoff) return normalized
  return { ...(normalized ?? createEmptyTurn(item.message_id)), id: item.message_id }
}

function loadedProcessBlockCount(message: MessageData | undefined): number {
  return message?.processBlocks?.filter((block) => block.kind !== 'stage').length ?? 0
}

function shouldLoadMessageProcess(message: MessageData | undefined): boolean {
  if (!message) return true
  const expectedCount = message.process_item_count ?? message.tool_call_count ?? 0
  if (message.status === 'running') return true
  if (!message.processBlocks) return expectedCount > 0 || !!message.has_tool_calls
  return expectedCount > loadedProcessBlockCount(message)
}

function flushBuffer(set: (p: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void, get: () => ChatState): void {
  if (streamingFlushTimer) { clearTimeout(streamingFlushTimer); streamingFlushTimer = null }
  const snapshot = streamingBuffer.flush()
  if (!snapshot) return
  const sid = get().sessionId
  set((state) => {
    const cur = normalizeActiveTurn(state.streamingMessage)
    let up: StreamingMessage = cur
      ? { ...cur, processBlocks: cur.processBlocks.map(b => b.kind === 'tool' ? { ...b, toolCall: { ...b.toolCall } } : { ...b }), toolCalls: [...cur.toolCalls] }
      : createEmptyTurn(String(snapshot.messageId || `stream-${sid}-${Date.now()}`))
    if (snapshot.messageId && (up.id.startsWith('pending-') || !turnHasVisibleContent(up) || (!!up.stage && !up.finalAnswer && up.processBlocks.every(b => b.kind === 'stage')))) {
      up = { ...up, id: snapshot.messageId }
    }
    for (const entry of snapshot.entries) {
      if (entry.kind === 'toolUpdate' && !up.processBlocks.some(b => b.kind === 'tool' && b.toolCall.id === entry.toolCall.id) && !shouldCreateToolFromUpdate(entry.toolCall)) continue
      up = applyTurnEntry(up, entry)
    }
    lastStreamingSnapshot = up
    return { streamingMessage: up }
  })
}

function scheduleFlush(set: (p: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void, get: () => ChatState): void {
  if (streamingFlushTimer) return
  streamingFlushTimer = setTimeout(() => { streamingFlushTimer = null; flushBuffer(set, get) }, 50)
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  messages: [],
  events: [],
  streamingMessage: null,
  plan: [],
  pendingPermissions: [],
  pendingElicitations: [],
  capabilities: { ...defaultCaps },
  usage: null,
  turnUsage: null,
  loading: false,
  isRunning: false,
  turnProcessLoadingByMessageId: {},
  turnProcessErrorByMessageId: {},

  enterSession: (sessionId) => {
    const prev = get().sessionId
    if (prev) wsClient.unsubscribe([prev])
    streamingBuffer.clear()
    if (streamingFlushTimer) { clearTimeout(streamingFlushTimer); streamingFlushTimer = null }
    lastStreamingSnapshot = null
    set({
      sessionId, messages: [], events: [], streamingMessage: null,
      plan: [], pendingPermissions: [], pendingElicitations: [],
      capabilities: { ...defaultCaps }, usage: null, turnUsage: null, loading: true, isRunning: false,
      turnProcessLoadingByMessageId: {}, turnProcessErrorByMessageId: {},
    })
    wsClient.subscribe([sessionId])

    wsClient.request({ type: 'sessions.messages', sessionId }).then((data) => {
      if (get().sessionId !== sessionId) return
      const messages = data as MessageData[]
      const running = messages.filter(m => m.session_id === sessionId && m.role === 'agent' && m.status === 'running').at(-1)
      if (running) promptStartTime = timestampMs(running.started_at) ?? timestampMs(running.timestamp) ?? promptStartTime
      set({ messages: messages.map(normalizeMessage), loading: false, isRunning: !!running })

      if (running) void get().fetchMessageProcess(sessionId, running.id)
    }).catch(() => { if (get().sessionId === sessionId) set({ loading: false }) })

    wsClient.request({ type: 'sessions.events', sessionId, limit: 500 }).then((data) => {
      if (get().sessionId !== sessionId) return
      const events = data as SessionEventData[]
      const reduced = reduceSessionEvents(events.filter(e => !mirroredRealtimeEventTypes.has(e.type)))
      set(state => ({
        events,
        capabilities: mergeCapabilities(state.capabilities, reduced.capabilities),
        plan: reduced.plan,
        pendingPermissions: reduced.pendingPermissions,
        pendingElicitations: reduced.pendingElicitations,
      }))
    }).catch(() => {})
  },

  leaveSession: () => {
    const sid = get().sessionId
    if (sid) wsClient.unsubscribe([sid])
    streamingBuffer.clear()
    if (streamingFlushTimer) { clearTimeout(streamingFlushTimer); streamingFlushTimer = null }
    set({
      sessionId: null,
      messages: [],
      events: [],
      streamingMessage: null,
      plan: [],
      pendingPermissions: [],
      pendingElicitations: [],
      isRunning: false,
      turnProcessLoadingByMessageId: {},
      turnProcessErrorByMessageId: {},
    })
  },

  sendPrompt: (content, images) => {
    const sid = get().sessionId
    if (!sid) return
    const clientMessageId = `msg-local-${Date.now()}`
    const msg: Record<string, unknown> = { type: 'prompt', sessionId: sid, content, clientMessageId }
    if (images?.length) msg.images = images
    wsClient.send(msg)
    promptStartTime = Date.now()
    set(state => ({
      messages: [...state.messages, normalizeMessage({
        id: clientMessageId, session_id: sid, role: 'human', content,
        thinking: null, tool_calls_json: null, decision_json: null,
        attachments_json: images?.length ? JSON.stringify(images) : null,
        file_changes_json: null, timestamp: new Date().toISOString(),
      })],
      streamingMessage: applyTurnEntry(createEmptyTurn(`pending-${sid}-${Date.now()}`), { kind: 'stage', text: '正在准备 Agent...' }),
      turnUsage: null, isRunning: true,
    }))
  },

  fetchMessageProcess: async (sessionId, messageId) => {
    const existing = get().messages.find((message) => message.id === messageId && message.session_id === sessionId)
    if (!shouldLoadMessageProcess(existing)) return
    set((state) => ({
      turnProcessLoadingByMessageId: { ...state.turnProcessLoadingByMessageId, [messageId]: true },
      turnProcessErrorByMessageId: { ...state.turnProcessErrorByMessageId, [messageId]: '' },
    }))
    try {
      const items = await wsClient.request({ type: 'sessions.messageProcess', sessionId, messageId }) as TurnProcessItemInfo[]
      if (get().sessionId !== sessionId) return
      let turn = turnFromProcessItems(messageId, items)
      if (items.length === 0 && existing?.has_tool_calls) {
        const events = await wsClient.request({ type: 'sessions.messageEvents', sessionId, messageId }) as SessionEventData[]
        if (get().sessionId !== sessionId) return
        turn = turnFromEvents(messageId, events)
      }
      set((state) => {
        const current = state.messages.find((message) => message.id === messageId && message.session_id === sessionId)
        return {
          messages: state.messages.map((message) => message.id === messageId && message.session_id === sessionId
            ? {
                ...message,
                processBlocks: turn.processBlocks,
                finalAnswer: turn.finalAnswer || message.content,
                parsedToolCalls: turn.toolCalls.length > 0 ? turn.toolCalls : message.parsedToolCalls,
              }
            : message),
          streamingMessage: current?.status === 'running'
            ? {
                ...turn,
                finalAnswer: current.content,
                content: current.content,
                done: false,
              }
            : state.streamingMessage,
          turnProcessLoadingByMessageId: { ...state.turnProcessLoadingByMessageId, [messageId]: false },
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((state) => ({
        turnProcessLoadingByMessageId: { ...state.turnProcessLoadingByMessageId, [messageId]: false },
        turnProcessErrorByMessageId: { ...state.turnProcessErrorByMessageId, [messageId]: message },
      }))
    }
  },

  cancelTurn: async () => {
    const sid = get().sessionId
    if (!sid) return
    try { await wsClient.request({ type: 'session.cancel', sessionId: sid }) } catch { /* ignore */ }
  },

  respondPermission: async (requestId, optionId, cancelled) => {
    const sid = get().sessionId
    if (!sid) return
    await wsClient.request({ type: 'permission.respond', sessionId: sid, permissionRequestId: requestId, optionId, cancelled })
  },

  respondElicitation: async (requestId, action, content) => {
    const sid = get().sessionId
    if (!sid) return
    await wsClient.request({ type: 'elicitation.respond', sessionId: sid, elicitationRequestId: requestId, action, content })
  },

  setupListeners: () => {
    const offs: (() => void)[] = []

    offs.push(wsClient.on('session:event', (msg) => {
      const sid = msg.sessionId as string
      if (sid !== get().sessionId) return
      const event = msg.event as SessionEventData
      if (event.type.startsWith('lifecycle.') && !shouldShowLifecycleStage(event.type)) return
      if (mirroredRealtimeEventTypes.has(event.type)) return
      set(state => {
        const events = [...state.events.filter(e => e.id !== event.id), event].sort((a, b) => a.sequence - b.sequence).slice(-500)
        const reduced = applySessionEvent({
          streamingMessage: state.streamingMessage, usage: state.usage, turnUsage: state.turnUsage,
          capabilities: state.capabilities, plan: state.plan,
          pendingPermissions: state.pendingPermissions, pendingElicitations: state.pendingElicitations,
        }, event)
        return {
          events,
          streamingMessage: reduced.streamingMessage,
          usage: reduced.usage, turnUsage: reduced.turnUsage,
          capabilities: reduced.capabilities, plan: reduced.plan,
          pendingPermissions: reduced.pendingPermissions, pendingElicitations: reduced.pendingElicitations,
        }
      })
    }))

    offs.push(wsClient.on('session:process_item', (msg) => {
      const sid = msg.sessionId as string
      if (sid !== get().sessionId) return
      const item = msg.item as TurnProcessItemInfo
      const block = turnFromProcessItems(item.message_id, [item]).processBlocks[0]
      if (!block) return
      set(state => {
        const base = streamingBaseForProcessItem(state.streamingMessage, item, state.isRunning)
        const streaming = base?.id === item.message_id ? mergeProcessBlockIntoStreaming(base, block) : state.streamingMessage
        return {
          streamingMessage: streaming,
          messages: state.messages.map((message) => {
            if (message.id !== item.message_id || message.session_id !== sid) return message
            const processBlocks = mergeProcessBlock(message.processBlocks || [], block)
            return {
              ...message,
              processBlocks,
              process_item_count: processBlocks.filter((processBlock) => processBlock.kind !== 'stage').length,
            }
          }),
        }
      })
    }))

    offs.push(wsClient.on('session:update', (msg) => {
      const sid = msg.sessionId as string
      if (sid !== get().sessionId) return
      const data = msg.data as Record<string, unknown>

      if (typeof data.eventType === 'string' && data.eventType.startsWith('lifecycle.')) {
        if (!shouldShowLifecycleStage(data.eventType)) return
        const stage = String(data.content || '')
        set(state => {
          const base: StreamingMessage = state.streamingMessage || createEmptyTurn(String(data.messageId || `stream-${sid}-${Date.now()}`))
          return { streamingMessage: applyTurnEntry(base, { kind: 'stage', text: stage }), isRunning: true }
        })
        return
      }
      if (data.eventType === 'permission.result' || data.eventType === 'elicitation.result') return
      if (data.usage) { set({ usage: data.usage as UsageInfo }); return }
      if (data.plan) { set({ plan: data.plan as PlanEntry[] }); return }
      if (data.configOptions) { set(s => ({ capabilities: capabilitiesFromConfig(s.capabilities, data.configOptions as ConfigOptionInfo[]) })); return }
      if (data.commands) { set(s => ({ capabilities: { ...s.capabilities, commands: data.commands as AvailableCommandInfo[] } })); return }
      if (data.permissionRequest) { const r = data.permissionRequest as PermissionRequestInfo; set(s => ({ pendingPermissions: [...s.pendingPermissions.filter(p => p.id !== r.id), r] })); return }
      if (data.elicitationRequest) { const r = data.elicitationRequest as ElicitationRequestInfo; set(s => ({ pendingElicitations: [...s.pendingElicitations.filter(p => p.id !== r.id), r] })); return }

      if (data.contentDelta || data.thinking || data.toolCall || data.toolCallUpdate) {
        streamingBuffer.push({
          messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
          contentDelta: typeof data.contentDelta === 'string' ? data.contentDelta : undefined,
          thinking: typeof data.thinking === 'string' ? data.thinking : undefined,
          toolCall: data.toolCall as ToolCallInfo | undefined,
          toolCallUpdate: data.toolCallUpdate as ToolCallInfo | undefined,
        })
        set({ isRunning: true })
        scheduleFlush(set, get)
      }
    }))

    offs.push(wsClient.on('session:done', (msg) => {
      const sid = msg.sessionId as string
      if (sid !== get().sessionId) return
      flushBuffer(set, get)
      const tu = msg.turnUsage as TurnUsageInfo | undefined
      const cost = get().usage?.costAmount
      const elapsed = promptStartTime > 0 ? Math.round((Date.now() - promptStartTime) / 1000) : undefined
      promptStartTime = 0
      const s = get().streamingMessage || lastStreamingSnapshot
      lastStreamingSnapshot = null
      const turnStats = tu ? JSON.stringify({ ...tu, costAmount: cost, elapsedSeconds: elapsed }) : null

      if (turnHasFinalizableContent(s)) {
        const finalizedToolCalls = s.toolCalls.map(tc => (tc.status === 'pending' || tc.status === 'in_progress') ? { ...tc, status: 'completed' } : tc)
        const finalizedBlocks = processBlocksForCompletedTurn(s).map(b =>
          b.kind === 'tool' ? { ...b, toolCall: (b.toolCall.status === 'pending' || b.toolCall.status === 'in_progress') ? { ...b.toolCall, status: 'completed' } : b.toolCall } : b
        )
        const newMsg: MessageData = {
          id: s.id, session_id: sid, role: 'agent', content: s.finalAnswer,
          thinking: s.thinking || null,
          tool_calls_json: finalizedToolCalls.length > 0 ? JSON.stringify(finalizedToolCalls) : null,
          decision_json: turnStats, attachments_json: null, file_changes_json: null,
          timestamp: new Date().toISOString(),
          processBlocks: finalizedBlocks, finalAnswer: s.finalAnswer,
        }
        set(st => ({
          messages: appendFinalizedMessage(st.messages, newMsg),
          streamingMessage: null, turnUsage: tu || st.turnUsage, plan: clearPlanOnTurnDone(), isRunning: false,
        }))
      } else {
        const error = typeof msg.error === 'string' ? msg.error : ''
        const fm = error
          ? buildErrorAgentMessage(sid, String(msg.messageId || `error-${Date.now()}`), error)
          : buildCompletedAgentMessage(sid, get().events, tu, cost, elapsed)
        if (fm) {
          if (turnStats && !fm.decision_json) fm.decision_json = turnStats
          set(st => ({ messages: appendFinalizedMessage(st.messages, fm), streamingMessage: null, turnUsage: tu || st.turnUsage, plan: clearPlanOnTurnDone(), isRunning: false }))
        } else {
          set(st => ({ streamingMessage: null, turnUsage: tu || st.turnUsage, plan: clearPlanOnTurnDone(), isRunning: false }))
        }
      }
      wsClient.request({ type: 'sessions.messages', sessionId: sid }).then((data) => {
        if (get().sessionId !== sid) return
        set({ messages: mergeMessagesForSession(data as MessageData[], get().messages, sid) })
      }).catch(() => {})
    }))

    offs.push(wsClient.on('session:activity', (msg) => {
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : ''
      if (sessionId !== get().sessionId) return
      const state = msg.state === 'running' ? 'running' : 'idle'
      if (state === 'idle') {
        flushBuffer(set, get)
        set({ streamingMessage: null, isRunning: false })
        wsClient.request({ type: 'sessions.messages', sessionId }).then((data) => {
          if (get().sessionId !== sessionId) return
          set({ messages: mergeMessagesForSession(data as MessageData[], get().messages, sessionId) })
        }).catch(() => {})
      } else {
        set({ isRunning: true })
      }
    }))

    offs.push(wsClient.on('session:capabilities', (msg) => {
      const sid = msg.sessionId as string
      if (sid !== get().sessionId) return
      const c = msg.capabilities as Partial<SessionCapabilities>
      set(st => ({
        capabilities: {
          ...st.capabilities,
          models: c.models || st.capabilities.models,
          currentModelId: c.currentModelId || st.capabilities.currentModelId,
          modes: c.modes || st.capabilities.modes,
          currentModeId: c.currentModeId || st.capabilities.currentModeId,
          supportsImages: c.supportsImages ?? st.capabilities.supportsImages,
          configOptions: c.configOptions || st.capabilities.configOptions,
          commands: c.commands || st.capabilities.commands,
          sessionInfo: c.sessionInfo || st.capabilities.sessionInfo,
        },
      }))
    }))

    return () => offs.forEach(f => f())
  },
}))
