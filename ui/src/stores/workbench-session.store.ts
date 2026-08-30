import { create } from 'zustand'
import { commandClient } from '../services/command-client'
import { queryClient } from '../services/query-client'
import { wsClient } from '../services/ws-client'
import { interactionResponseFailure } from './interaction-response'
import { useSessionStore } from './session.store'
import type { ConversationUploadedFile, ConversationProcessState } from '../components/chat/conversation-types'
import type { FileChangeDetailInfo, ImageAttachmentInfo } from './session-events'
import {
  applySessionEvent,
  appendFinalizedMessage,
  buildCompletedAgentMessage,
  buildErrorAgentMessage,
  mergeMessagesForSession,
  normalizeMessage,
  shouldCreateToolFromUpdate,
  defaultCaps,
  mergeCapabilities,
  reduceSessionEvents,
  type ElicitationRequestInfo,
  type MessageData,
  type PermissionRequestInfo,
  type SessionEventData,
  type StreamingMessage,
  type ToolCallInfo,
  type TurnProcessItemInfo,
  type TurnUsageInfo,
  type UsageInfo,
  type SessionCapabilities,
} from './session-events'
import { applyTurnEntry, createEmptyTurn, turnFromEvents, turnFromProcessItems, type TurnProcessBlock, type TurnViewModel } from './turn-blocks'

interface WorkbenchSessionState {
  selectedSessionId: string | null
  messages: MessageData[]
  events: SessionEventData[]
  streamingMessage: StreamingMessage | null
  loading: boolean
  error: string | null
  running: boolean
  sending: boolean
  stopping: boolean
  stopError: string | null
  stoppingSessions: Record<string, true>
  stopErrorsBySession: Record<string, string>
  pendingPermissions: PermissionRequestInfo[]
  pendingElicitations: ElicitationRequestInfo[]
  interactionError: string | null
  usage: UsageInfo | null
  capabilities: SessionCapabilities
  hasMoreMessages: boolean
  loadingOlderMessages: boolean
  processByMessageId: Record<string, ConversationProcessState>
  fileChangeDetailsByMessageId: Record<string, FileChangeDetailInfo>
  fileChangeLoadingByKey: Record<string, boolean>
  fileChangeErrorByKey: Record<string, string>
  processItemLoadingByKey: Record<string, boolean>
  processItemErrorByKey: Record<string, string>
  select: (sessionId: string | null) => Promise<void>
  sendPrompt: (content: string, images?: ImageAttachmentInfo[], files?: ConversationUploadedFile[]) => Promise<void>
  cancel: () => Promise<void>
  loadOlderMessages: () => Promise<void>
  loadMessageProcess: (messageId: string) => Promise<void>
  loadFileChanges: (messageId: string) => Promise<void>
  loadProcessItemDetail: (messageId: string, itemId: string) => Promise<void>
  setModel: (modelId: string) => Promise<void>
  setMode: (modeId: string) => Promise<void>
  setConfig: (configId: string, value: string | boolean) => Promise<void>
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
  let turn: TurnViewModel = current && current.id === messageId ? current : createEmptyTurn(messageId)
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

function mergeBlocksIntoTurn(turn: StreamingMessage, blocks: TurnProcessBlock[]): StreamingMessage {
  return blocks.reduce(mergeBlockIntoTurn, turn)
}

function reducePendingInteractions(
  events: SessionEventData[],
  pendingPermissions: PermissionRequestInfo[] = [],
  pendingElicitations: ElicitationRequestInfo[] = [],
  usage: UsageInfo | null = null,
  capabilities: SessionCapabilities = { ...defaultCaps },
): Pick<WorkbenchSessionState, 'pendingPermissions' | 'pendingElicitations' | 'usage' | 'capabilities'> {
  const reduced = [...events].sort((left, right) => left.sequence - right.sequence).reduce(applySessionEvent, {
    streamingMessage: null,
    usage,
    turnUsage: null,
    capabilities: { ...capabilities },
    plan: [],
    pendingPermissions,
    pendingElicitations,
  })
  return { pendingPermissions: reduced.pendingPermissions, pendingElicitations: reduced.pendingElicitations, usage: reduced.usage, capabilities: reduced.capabilities }
}

function normalizeCapabilitySnapshot(value: unknown): SessionCapabilities | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Partial<SessionCapabilities>
  return {
    models: Array.isArray(snapshot.models) ? snapshot.models : [],
    currentModelId: typeof snapshot.currentModelId === 'string' ? snapshot.currentModelId : null,
    modes: Array.isArray(snapshot.modes) ? snapshot.modes : [],
    currentModeId: typeof snapshot.currentModeId === 'string' ? snapshot.currentModeId : null,
    supportsImages: snapshot.supportsImages === true,
    supportsAudio: snapshot.supportsAudio === true,
    configOptions: Array.isArray(snapshot.configOptions) ? snapshot.configOptions : [],
    commands: Array.isArray(snapshot.commands) ? snapshot.commands : [],
    sessionInfo: snapshot.sessionInfo,
  }
}

function withoutKey<T>(values: Record<string, T>, key: string): Record<string, T> {
  const next = { ...values }
  delete next[key]
  return next
}

function refreshCapabilities(sessionId: string, requestGeneration: number): void {
  void Promise.resolve()
    .then(() => wsClient.request({ type: 'session.getModels', sessionId }))
    .then((value: unknown) => {
      if (requestGeneration !== generation || useWorkbenchSessionStore.getState().selectedSessionId !== sessionId) return
      const incoming = normalizeCapabilitySnapshot(value)
      if (!incoming) return
      useWorkbenchSessionStore.setState((state) => ({ capabilities: mergeCapabilities(state.capabilities, incoming) }))
    })
    .catch(() => undefined)
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
        const reduced = applySessionEvent({
          streamingMessage: state.streamingMessage,
          usage: state.usage,
          turnUsage: null,
          capabilities: { ...state.capabilities },
          plan: [],
          pendingPermissions: state.pendingPermissions,
          pendingElicitations: state.pendingElicitations,
        }, event)
        return {
          events,
          streamingMessage: reduced.streamingMessage,
          running: !!reduced.streamingMessage || state.running,
          ...reducePendingInteractions([event], state.pendingPermissions, state.pendingElicitations, state.usage, state.capabilities),
        }
      })
    }),
    wsClient.on('session:capabilities', (message) => {
      if (!current(message)) return
      const incoming = normalizeCapabilitySnapshot(message.capabilities)
      if (!incoming) return
      set((state) => ({ capabilities: mergeCapabilities(state.capabilities, incoming) }))
    }),
    wsClient.on('session:activity', (message) => {
      if (message.state !== 'idle' || typeof message.sessionId !== 'string') return
      const sessionId = message.sessionId
      set((state) => ({
        stoppingSessions: withoutKey(state.stoppingSessions, sessionId),
        stopErrorsBySession: withoutKey(state.stopErrorsBySession, sessionId),
        ...(state.selectedSessionId === sessionId ? { stopping: false, stopError: null } : {}),
      }))
    }),
    wsClient.on('session:done', (message) => {
      if (!current(message)) return
      const state = useWorkbenchSessionStore.getState()
      const sid = state.selectedSessionId!
      const error = typeof message.error === 'string' ? message.error : ''
      const finalized = state.streamingMessage?.finalAnswer
        ? normalizeMessage({ id: state.streamingMessage.id, session_id: sid, role: 'agent', content: state.streamingMessage.finalAnswer, thinking: state.streamingMessage.thinking || null, tool_calls_json: state.streamingMessage.toolCalls.length ? JSON.stringify(state.streamingMessage.toolCalls) : null, decision_json: null, attachments_json: null, file_changes_json: null, timestamp: new Date().toISOString(), processBlocks: state.streamingMessage.processBlocks, finalAnswer: state.streamingMessage.finalAnswer })
        : error ? buildErrorAgentMessage(sid, `error-${Date.now()}`, error) : buildCompletedAgentMessage(sid, state.events, message.turnUsage as TurnUsageInfo | undefined)
      set((currentState) => ({ messages: finalized ? appendFinalizedMessage(currentState.messages, finalized) : currentState.messages, streamingMessage: null, running: false, sending: false, stopping: false, stopError: null, stoppingSessions: withoutKey(currentState.stoppingSessions, sid), stopErrorsBySession: withoutKey(currentState.stopErrorsBySession, sid) }))
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
  stopping: false,
  stopError: null,
  stoppingSessions: {},
  stopErrorsBySession: {},
  pendingPermissions: [],
  pendingElicitations: [],
  interactionError: null,
  usage: null,
  capabilities: { ...defaultCaps },
  hasMoreMessages: false,
  loadingOlderMessages: false,
  processByMessageId: {},
  fileChangeDetailsByMessageId: {},
  fileChangeLoadingByKey: {},
  fileChangeErrorByKey: {},
  processItemLoadingByKey: {},
  processItemErrorByKey: {},
  select: async (sessionId) => {
    const requestGeneration = ++generation
    const stopForSession = sessionId ? get().stoppingSessions[sessionId] === true : false
    const stopErrorForSession = sessionId ? get().stopErrorsBySession[sessionId] ?? null : null
    set({ selectedSessionId: sessionId, messages: [], events: [], streamingMessage: null, loading: !!sessionId, error: null, running: false, sending: false, stopping: stopForSession, stopError: stopErrorForSession, pendingPermissions: [], pendingElicitations: [], interactionError: null, usage: null, capabilities: { ...defaultCaps }, hasMoreMessages: false, loadingOlderMessages: false, processByMessageId: {}, fileChangeDetailsByMessageId: {}, fileChangeLoadingByKey: {}, fileChangeErrorByKey: {}, processItemLoadingByKey: {}, processItemErrorByKey: {} })
    setSubscription(sessionId)
    if (!sessionId) { set({ loading: false }); return }
    installListeners(set)
    refreshCapabilities(sessionId, requestGeneration)
    void commandClient.execute({ commandId: `workbench-read-${sessionId}-${Date.now()}`, type: 'sessions.markRead', sessionId }).catch(() => undefined)
    try {
      const [messagePage, recovery] = await Promise.all([
        queryClient.listSessionMessages({ sessionId, limit: 40 }),
        queryClient.getSessionRecovery({ sessionId, limit: 1000 }),
      ])
      if (requestGeneration !== generation) return
      const runningMessage = messagePage.items.filter((message) => message.role === 'agent' && message.status === 'running').at(-1)
      const recoveredStreaming = reduceSessionEvents(recovery.events).streamingMessage
      set({ messages: mergeMessagesForSession(messagePage.items, [], sessionId), events: recovery.events, ...reducePendingInteractions(recovery.events), streamingMessage: recoveredStreaming || (runningMessage ? { ...createEmptyTurn(runningMessage.id), finalAnswer: runningMessage.content, content: runningMessage.content, done: false } : null), running: !!runningMessage || !!recoveredStreaming, loading: false, hasMoreMessages: messagePage.hasMore })
      if (runningMessage) void useWorkbenchSessionStore.getState().loadMessageProcess(runningMessage.id)
    } catch (error) {
      if (requestGeneration === generation) set({ loading: false, error: error instanceof Error ? error.message : '会话加载失败' })
    }
  },
  sendPrompt: async (content, images = [], files = []) => {
    const sid = get().selectedSessionId
    if (!sid || (!content.trim() && images.length === 0 && files.length === 0)) return
    const clientMessageId = `workbench-${Date.now()}`
    const queueBehindActiveTurn = get().running
    const fileContext = files.length ? `${content.trim()}\n\n[文件附件]\n${files.map((file) => `- 文件路径: ${file.path}\n- MIME: ${file.mimeType}\n- 原始文件名: ${file.name}`).join('\n')}` : content.trim()
    set((state) => ({ sending: true, running: true, messages: [...state.messages, normalizeMessage({ id: clientMessageId, session_id: sid, role: 'human', content: fileContext, thinking: null, tool_calls_json: null, decision_json: null, attachments_json: images.length ? JSON.stringify(images) : null, file_changes_json: null, timestamp: new Date().toISOString(), parsedAttachments: images })], streamingMessage: queueBehindActiveTurn ? state.streamingMessage : createEmptyTurn(`pending-${clientMessageId}`) }))
    try {
      const commandImages = images.filter((image): image is ImageAttachmentInfo & { data: string } => typeof image.data === 'string').map((image) => ({ data: image.data, mimeType: image.mimeType }))
      await commandClient.execute({ commandId: clientMessageId, type: 'prompt', sessionId: sid, clientMessageId, content: fileContext, ...(commandImages.length ? { images: commandImages } : {}) })
      if (sid === get().selectedSessionId) set({ sending: false })
    } catch (error) {
      set((state) => ({ sending: false, running: queueBehindActiveTurn ? state.running : false, streamingMessage: queueBehindActiveTurn ? state.streamingMessage : null, messages: state.messages.filter((message) => message.id !== clientMessageId), error: error instanceof Error ? error.message : '消息发送失败' }))
      throw error
    }
  },
  loadOlderMessages: async () => {
    const sid = get().selectedSessionId
    if (!sid || get().loadingOlderMessages || !get().hasMoreMessages) return
    const current = get().messages.filter((message) => message.session_id === sid).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const oldest = current[0]
    if (!oldest) return
    set({ loadingOlderMessages: true })
    try {
      const page = await queryClient.listSessionMessages({ sessionId: sid, limit: 40, before: oldest.timestamp })
      if (sid !== get().selectedSessionId) return
      set((state) => ({ messages: mergeMessagesForSession(page.items, state.messages, sid), hasMoreMessages: page.hasMore, loadingOlderMessages: false }))
    } catch {
      if (sid === get().selectedSessionId) set({ loadingOlderMessages: false })
    }
  },
  loadMessageProcess: async (messageId) => {
    const sid = get().selectedSessionId
    if (!sid) return
    const message = get().messages.find((item) => item.id === messageId && item.session_id === sid)
    if (!message || get().processByMessageId[messageId]?.loading || get().processByMessageId[messageId]?.loaded) return
    set((state) => ({ processByMessageId: { ...state.processByMessageId, [messageId]: { blocks: state.processByMessageId[messageId]?.blocks || [], loading: true, loaded: false } } }))
    try {
      const items = await wsClient.request({ type: 'sessions.messageProcess', sessionId: sid, messageId }) as TurnProcessItemInfo[]
      let turn = turnFromProcessItems(messageId, items)
      if (!items.length && message.has_tool_calls) {
        const events = await wsClient.request({ type: 'sessions.messageEvents', sessionId: sid, messageId }) as SessionEventData[]
        turn = turnFromEvents(messageId, events)
      }
      if (sid !== get().selectedSessionId) return
      set((state) => {
        const streaming = message.status === 'running'
          ? state.streamingMessage?.id === messageId
            ? mergeBlocksIntoTurn({ ...state.streamingMessage, finalAnswer: state.streamingMessage.finalAnswer || message.content, content: state.streamingMessage.content || message.content, done: false }, turn.processBlocks)
            : { ...turn, finalAnswer: message.content, content: message.content, done: false }
          : state.streamingMessage
        return {
          messages: state.messages.map((item) => item.id === messageId && item.session_id === sid ? { ...item, processBlocks: turn.processBlocks, finalAnswer: turn.finalAnswer || item.content, parsedToolCalls: turn.toolCalls } : item),
          streamingMessage: streaming,
          processByMessageId: { ...state.processByMessageId, [messageId]: { blocks: turn.processBlocks, loading: false, loaded: true } },
        }
      })
    } catch (error) {
      set((state) => ({ processByMessageId: { ...state.processByMessageId, [messageId]: { blocks: state.processByMessageId[messageId]?.blocks || [], loading: false, loaded: false, error: error instanceof Error ? error.message : '执行过程加载失败' } } }))
    }
  },
  loadFileChanges: async (messageId) => {
    const sid = get().selectedSessionId
    if (!sid || get().fileChangeDetailsByMessageId[messageId]) return
    const key = `file:${messageId}`
    set((state) => ({ fileChangeLoadingByKey: { ...state.fileChangeLoadingByKey, [key]: true } }))
    try {
      const detail = await wsClient.request({ type: 'sessions.messageFileChanges', sessionId: sid, messageId }) as FileChangeDetailInfo
      if (sid !== get().selectedSessionId) return
      set((state) => ({ fileChangeDetailsByMessageId: { ...state.fileChangeDetailsByMessageId, [messageId]: detail }, fileChangeLoadingByKey: { ...state.fileChangeLoadingByKey, [key]: false } }))
    } catch (error) {
      set((state) => ({ fileChangeLoadingByKey: { ...state.fileChangeLoadingByKey, [key]: false }, fileChangeErrorByKey: { ...state.fileChangeErrorByKey, [key]: error instanceof Error ? error.message : '文件变更加载失败' } }))
    }
  },
  loadProcessItemDetail: async (messageId, itemId) => {
    const sid = get().selectedSessionId
    if (!sid) return
    const key = `${messageId}:${itemId}`
    if (get().processItemLoadingByKey[key]) return
    set((state) => ({ processItemLoadingByKey: { ...state.processItemLoadingByKey, [key]: true } }))
    try {
      const detail = await wsClient.request({ type: 'sessions.processItemDetail', sessionId: sid, messageId, itemId }) as TurnProcessItemInfo
      if (sid !== get().selectedSessionId) {
        set((state) => ({ processItemLoadingByKey: withoutKey(state.processItemLoadingByKey, key) }))
        return
      }
      const detailBlock = turnFromProcessItems(messageId, [detail]).processBlocks[0]
      if (!detailBlock) {
        set((state) => ({ processItemLoadingByKey: withoutKey(state.processItemLoadingByKey, key) }))
        return
      }
      set((state) => {
        const streaming = state.streamingMessage?.id === messageId
          ? mergeBlockIntoTurn(state.streamingMessage, detailBlock)
          : state.streamingMessage
        const processState = state.processByMessageId[messageId]
        return {
          messages: state.messages.map((item) => item.id === messageId ? { ...item, processBlocks: mergeProcessBlock(item.processBlocks ?? [], detailBlock) } : item),
          streamingMessage: streaming,
          processByMessageId: processState
            ? { ...state.processByMessageId, [messageId]: { ...processState, blocks: mergeProcessBlock(processState.blocks, detailBlock) } }
            : state.processByMessageId,
          processItemLoadingByKey: { ...state.processItemLoadingByKey, [key]: false },
          processItemErrorByKey: withoutKey(state.processItemErrorByKey, key),
        }
      })
    } catch (error) {
      set((state) => ({ processItemLoadingByKey: { ...state.processItemLoadingByKey, [key]: false }, processItemErrorByKey: { ...state.processItemErrorByKey, [key]: error instanceof Error ? error.message : '执行详情加载失败' } }))
    }
  },
  setModel: async (modelId) => {
    const sid = get().selectedSessionId
    if (!sid) return
    await wsClient.request({ type: 'session.setModel', sessionId: sid, modelId })
    if (sid === get().selectedSessionId) set((state) => ({ capabilities: { ...state.capabilities, currentModelId: modelId } }))
  },
  setMode: async (modeId) => {
    const sid = get().selectedSessionId
    if (!sid) return
    await wsClient.request({ type: 'session.setMode', sessionId: sid, modeId })
    if (sid === get().selectedSessionId) set((state) => ({ capabilities: { ...state.capabilities, currentModeId: modeId } }))
  },
  setConfig: async (configId, value) => {
    const sid = get().selectedSessionId
    if (!sid) return
    await wsClient.request({ type: 'session.setConfig', sessionId: sid, configId, value })
    if (sid === get().selectedSessionId) set((state) => ({ capabilities: { ...state.capabilities, configOptions: state.capabilities.configOptions.map((option) => option.id === configId ? { ...option, currentValue: value } : option) } }))
  },
  cancel: async () => {
    const sid = get().selectedSessionId
    if (!sid) return
    set((state) => ({ stopping: true, stopError: null, stoppingSessions: { ...state.stoppingSessions, [sid]: true }, stopErrorsBySession: withoutKey(state.stopErrorsBySession, sid) }))
    try {
      await commandClient.execute({ commandId: `cancel-${sid}-${Date.now()}`, type: 'session.cancel', sessionId: sid })
    } catch (error) {
      const message = error instanceof Error ? error.message : '停止失败，请重试'
      set((state) => ({ stopping: sid === state.selectedSessionId ? false : state.stopping, stopError: sid === state.selectedSessionId ? message : state.stopError, stoppingSessions: withoutKey(state.stoppingSessions, sid), stopErrorsBySession: { ...state.stopErrorsBySession, [sid]: message } }))
      throw error
    }
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
  dispose: () => { generation += 1; setSubscription(null); removeListeners?.(); set({ selectedSessionId: null, messages: [], events: [], streamingMessage: null, loading: false, error: null, running: false, sending: false, stopping: false, stopError: null, stoppingSessions: {}, stopErrorsBySession: {}, pendingPermissions: [], pendingElicitations: [], interactionError: null, usage: null, capabilities: { ...defaultCaps }, hasMoreMessages: false, loadingOlderMessages: false, processByMessageId: {}, fileChangeDetailsByMessageId: {}, fileChangeLoadingByKey: {}, fileChangeErrorByKey: {}, processItemLoadingByKey: {}, processItemErrorByKey: {} }) },
}))
