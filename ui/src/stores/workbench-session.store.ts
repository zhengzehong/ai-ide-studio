import { create } from 'zustand'
import { commandClient } from '../services/command-client'
import { queryClient } from '../services/query-client'
import { wsClient } from '../services/ws-client'
import { interactionResponseFailure } from './interaction-response'
import { useSessionStore } from './session.store'
import {
  applySessionEvent,
  appendFinalizedMessage,
  buildCompletedAgentMessage,
  buildErrorAgentMessage,
  mergeMessagesForSession,
  normalizeMessage,
  shouldCreateToolFromUpdate,
  defaultCaps,
  type ElicitationRequestInfo,
  type MessageData,
  type PermissionRequestInfo,
  type SessionEventData,
  type StreamingMessage,
  type ToolCallInfo,
  type TurnProcessItemInfo,
  type TurnUsageInfo,
} from './session-events'
import { applyTurnEntry, createEmptyTurn, turnFromProcessItems, type TurnProcessBlock, type TurnViewModel } from './turn-blocks'

interface WorkbenchSessionState {
  selectedSessionId: string | null
  messages: MessageData[]
  events: SessionEventData[]
  streamingMessage: StreamingMessage | null
  loading: boolean
  error: string | null
  running: boolean
  sending: boolean
  pendingPermissions: PermissionRequestInfo[]
  pendingElicitations: ElicitationRequestInfo[]
  interactionError: string | null
  select: (sessionId: string | null) => Promise<void>
  sendPrompt: (content: string) => Promise<void>
  cancel: () => Promise<void>
  respondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  respondElicitation: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => Promise<void>
  dispose: () => void
}

let subscribedSessionId: string | null = null
let generation = 0
let listenersInstalled = false
let removeListeners: (() => void) | null = null

function setSubscription(sessionId: string | null): void {
  if (subscribedSessionId === sessionId) return
  if (subscribedSessionId && useSessionStore.getState().currentSessionId !== subscribedSessionId) {
    wsClient.unsubscribe([subscribedSessionId])
  }
  subscribedSessionId = sessionId
  if (sessionId) wsClient.subscribe([sessionId])
}

function applyRealtimeTurn(current: StreamingMessage | null, sessionId: string, data: Record<string, unknown>): StreamingMessage {
  const messageId = typeof data.messageId === 'string' ? data.messageId : `workbench-${sessionId}`
  let turn: TurnViewModel = current && current.id === messageId ? current : { ...(current ?? createEmptyTurn(messageId)), id: messageId }
  if (typeof data.contentDelta === 'string') turn = applyTurnEntry(turn, { kind: 'reply', text: data.contentDelta })
  if (typeof data.thinking === 'string') turn = applyTurnEntry(turn, { kind: 'thinking', text: data.thinking })
  if (data.toolCall && typeof data.toolCall === 'object') turn = applyTurnEntry(turn, { kind: 'toolCall', toolCall: data.toolCall as ToolCallInfo })
  if (data.toolCallUpdate && typeof data.toolCallUpdate === 'object') {
    const update = data.toolCallUpdate as ToolCallInfo
    if (turn.processBlocks.some((block) => block.kind === 'tool' && block.toolCall.id === update.id) || shouldCreateToolFromUpdate(update)) {
      turn = applyTurnEntry(turn, { kind: 'toolUpdate', toolCall: update })
    }
  }
  return turn
}

function mergeProcessBlock(blocks: TurnProcessBlock[], block: TurnProcessBlock): TurnProcessBlock[] {
  const next = blocks.filter((item) => item.id !== block.id && !(item.kind === 'tool' && block.kind === 'tool' && item.toolCall.id === block.toolCall.id))
  return [...next, block].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
}

function mergeBlockIntoTurn(turn: StreamingMessage, block: TurnProcessBlock): StreamingMessage {
  const processBlocks = mergeProcessBlock(turn.processBlocks, block)
  return {
    ...turn,
    processBlocks,
    thinking: processBlocks.filter((item) => item.kind === 'thinking').map((item) => item.text).join(''),
    toolCalls: processBlocks.filter((item): item is Extract<TurnProcessBlock, { kind: 'tool' }> => item.kind === 'tool').map((item) => item.toolCall),
  }
}

function reducePendingInteractions(
  events: SessionEventData[],
  pendingPermissions: PermissionRequestInfo[] = [],
  pendingElicitations: ElicitationRequestInfo[] = [],
): Pick<WorkbenchSessionState, 'pendingPermissions' | 'pendingElicitations'> {
  const reduced = [...events].sort((left, right) => left.sequence - right.sequence).reduce(applySessionEvent, {
    streamingMessage: null,
    usage: null,
    turnUsage: null,
    capabilities: { ...defaultCaps },
    plan: [],
    pendingPermissions,
    pendingElicitations,
  })
  return { pendingPermissions: reduced.pendingPermissions, pendingElicitations: reduced.pendingElicitations }
}

function installListeners(set: (value: Partial<WorkbenchSessionState> | ((state: WorkbenchSessionState) => Partial<WorkbenchSessionState>)) => void): void {
  if (listenersInstalled) return
  const current = (message: Record<string, unknown>): boolean => typeof message.sessionId === 'string' && message.sessionId === useWorkbenchSessionStore.getState().selectedSessionId
  const offs = [
    wsClient.on('session:update', (message) => {
      if (!current(message)) return
      const data = message.data as Record<string, unknown>
      if (data.permissionRequest) {
        const request = data.permissionRequest as PermissionRequestInfo
        set((state) => ({ pendingPermissions: [...state.pendingPermissions.filter((item) => item.id !== request.id), request], interactionError: null }))
        return
      }
      if (data.elicitationRequest) {
        const request = data.elicitationRequest as ElicitationRequestInfo
        set((state) => ({ pendingElicitations: [...state.pendingElicitations.filter((item) => item.id !== request.id), request], interactionError: null }))
        return
      }
      if (data.contentDelta || data.thinking || data.toolCall || data.toolCallUpdate) set((state) => ({ streamingMessage: applyRealtimeTurn(state.streamingMessage, state.selectedSessionId!, data), running: true }))
    }),
    wsClient.on('session:process_item', (message) => {
      if (!current(message)) return
      const item = message.item as TurnProcessItemInfo
      const block = turnFromProcessItems(item.message_id, [item]).processBlocks[0]
      if (!block) return
      set((state) => {
        const base = state.streamingMessage?.id === item.message_id
          ? state.streamingMessage
          : state.running ? { ...(state.streamingMessage ?? createEmptyTurn(item.message_id)), id: item.message_id } : state.streamingMessage
        return {
          streamingMessage: base ? mergeBlockIntoTurn(base, block) : null,
          messages: state.messages.map((entry) => entry.id === item.message_id ? { ...entry, processBlocks: mergeProcessBlock(entry.processBlocks ?? [], block) } : entry),
        }
      })
    }),
    wsClient.on('session:event', (message) => {
      if (!current(message)) return
      const event = message.event as SessionEventData
      set((state) => {
        const events = [...state.events.filter((item) => item.id !== event.id), event].sort((a, b) => a.sequence - b.sequence)
        return { events, ...reducePendingInteractions([event], state.pendingPermissions, state.pendingElicitations) }
      })
    }),
    wsClient.on('session:done', (message) => {
      if (!current(message)) return
      const state = useWorkbenchSessionStore.getState()
      const sid = state.selectedSessionId!
      const error = typeof message.error === 'string' ? message.error : ''
      const finalized = state.streamingMessage?.finalAnswer
        ? normalizeMessage({ id: state.streamingMessage.id, session_id: sid, role: 'agent', content: state.streamingMessage.finalAnswer, thinking: state.streamingMessage.thinking || null, tool_calls_json: state.streamingMessage.toolCalls.length ? JSON.stringify(state.streamingMessage.toolCalls) : null, decision_json: null, attachments_json: null, file_changes_json: null, timestamp: new Date().toISOString(), processBlocks: state.streamingMessage.processBlocks, finalAnswer: state.streamingMessage.finalAnswer })
        : error ? buildErrorAgentMessage(sid, `error-${Date.now()}`, error) : buildCompletedAgentMessage(sid, state.events, message.turnUsage as TurnUsageInfo | undefined)
      set((currentState) => ({ messages: finalized ? appendFinalizedMessage(currentState.messages, finalized) : currentState.messages, streamingMessage: null, running: false, sending: false }))
      void useWorkbenchSessionStore.getState().select(sid)
    }),
  ]
  listenersInstalled = true
  removeListeners = () => { offs.forEach((off) => off()); listenersInstalled = false; removeListeners = null }
}

export const useWorkbenchSessionStore = create<WorkbenchSessionState>((set, get) => ({
  selectedSessionId: null,
  messages: [],
  events: [],
  streamingMessage: null,
  loading: false,
  error: null,
  running: false,
  sending: false,
  pendingPermissions: [],
  pendingElicitations: [],
  interactionError: null,
  select: async (sessionId) => {
    const requestGeneration = ++generation
    set({ selectedSessionId: sessionId, messages: [], events: [], streamingMessage: null, loading: !!sessionId, error: null, running: false, sending: false, pendingPermissions: [], pendingElicitations: [], interactionError: null })
    setSubscription(sessionId)
    if (!sessionId) { set({ loading: false }); return }
    installListeners(set)
    void commandClient.execute({ commandId: `workbench-read-${sessionId}-${Date.now()}`, type: 'sessions.markRead', sessionId }).catch(() => undefined)
    try {
      const [messagePage, recovery] = await Promise.all([
        queryClient.listSessionMessages({ sessionId, limit: 40 }),
        queryClient.getSessionRecovery({ sessionId, limit: 1000 }),
      ])
      if (requestGeneration !== generation) return
      const runningMessage = messagePage.items.filter((message) => message.role === 'agent' && message.status === 'running').at(-1)
      set({ messages: mergeMessagesForSession(messagePage.items, [], sessionId), events: recovery.events, ...reducePendingInteractions(recovery.events), streamingMessage: runningMessage ? { ...createEmptyTurn(runningMessage.id), finalAnswer: runningMessage.content, content: runningMessage.content, done: false } : null, running: !!runningMessage, loading: false })
    } catch (error) {
      if (requestGeneration === generation) set({ loading: false, error: error instanceof Error ? error.message : '会话加载失败' })
    }
  },
  sendPrompt: async (content) => {
    const sid = get().selectedSessionId
    if (!sid || !content.trim() || get().sending) return
    const clientMessageId = `workbench-${Date.now()}`
    set((state) => ({ sending: true, running: true, messages: [...state.messages, normalizeMessage({ id: clientMessageId, session_id: sid, role: 'human', content: content.trim(), thinking: null, tool_calls_json: null, decision_json: null, attachments_json: null, file_changes_json: null, timestamp: new Date().toISOString() })], streamingMessage: createEmptyTurn(`pending-${clientMessageId}`) }))
    try {
      await commandClient.execute({ commandId: clientMessageId, type: 'prompt', sessionId: sid, clientMessageId, content: content.trim() })
    } catch (error) {
      set((state) => ({ sending: false, running: false, streamingMessage: null, messages: state.messages.filter((message) => message.id !== clientMessageId), error: error instanceof Error ? error.message : '消息发送失败' }))
      throw error
    }
  },
  cancel: async () => {
    const sid = get().selectedSessionId
    if (!sid) return
    await commandClient.execute({ commandId: `cancel-${sid}-${Date.now()}`, type: 'session.cancel', sessionId: sid })
  },
  respondPermission: async (requestId, optionId, cancelled) => {
    const sid = get().selectedSessionId
    if (!sid) return
    try {
      await commandClient.execute({ commandId: `workbench-permission-${requestId}`, type: 'permission.respond', sessionId: sid, permissionRequestId: requestId, optionId, cancelled })
      if (sid !== get().selectedSessionId) return
      set((state) => ({ pendingPermissions: state.pendingPermissions.filter((request) => request.id !== requestId), interactionError: null }))
    } catch (error) {
      if (sid !== get().selectedSessionId) return
      const failure = interactionResponseFailure(error, 'permission')
      set((state) => ({ pendingPermissions: failure.expired ? state.pendingPermissions.filter((request) => request.id !== requestId) : state.pendingPermissions, interactionError: failure.message }))
    }
  },
  respondElicitation: async (requestId, action, content) => {
    const sid = get().selectedSessionId
    if (!sid) return
    try {
      await commandClient.execute({ commandId: `workbench-elicitation-${requestId}`, type: 'elicitation.respond', sessionId: sid, elicitationRequestId: requestId, action, content })
      if (sid !== get().selectedSessionId) return
      set((state) => ({ pendingElicitations: state.pendingElicitations.filter((request) => request.id !== requestId), interactionError: null }))
    } catch (error) {
      if (sid !== get().selectedSessionId) return
      const failure = interactionResponseFailure(error, 'elicitation')
      set((state) => ({ pendingElicitations: failure.expired ? state.pendingElicitations.filter((request) => request.id !== requestId) : state.pendingElicitations, interactionError: failure.message }))
    }
  },
  dispose: () => { generation += 1; setSubscription(null); removeListeners?.(); set({ selectedSessionId: null, messages: [], events: [], streamingMessage: null, loading: false, error: null, running: false, sending: false, pendingPermissions: [], pendingElicitations: [], interactionError: null }) },
}))
