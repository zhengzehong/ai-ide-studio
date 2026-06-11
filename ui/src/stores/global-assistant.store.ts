import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import type { AgentData } from './agent.store'
import type { SessionData } from './session.store'
import {
  appendFinalizedMessage,
  applySessionEvent,
  buildCompletedAgentMessage,
  buildErrorAgentMessage,
  capabilitiesFromConfig,
  clearPlanOnTurnDone,
  defaultCaps,
  mergeCapabilities,
  mergeMessagesForSession,
  normalizeMessage,
  shouldCreateToolFromUpdate,
  shouldShowLifecycleStage,
  type AvailableCommandInfo,
  type ConfigOptionInfo,
  type ElicitationRequestInfo,
  type FileChangeDetailInfo,
  type ImageAttachmentInfo,
  type MessageData,
  type PermissionRequestInfo,
  type PlanEntry,
  type SessionCapabilities,
  type SessionEventData,
  type StreamingMessage,
  type ToolCallInfo,
  type TurnProcessItemInfo,
  type TurnUsageInfo,
  type UsageInfo,
} from './session-events'
import {
  applyTurnEntry,
  createEmptyTurn,
  processBlocksForCompletedTurn,
  turnFromEvents,
  turnFromProcessItems,
  turnHasFinalizableContent,
  turnHasVisibleContent,
  type TurnProcessBlock,
} from './turn-blocks'

const CHAT_MESSAGE_PAGE_SIZE = 20

export interface GlobalAssistantRow {
  id: string
  agent_id: string
  session_id: string
  workspace_dir: string
  enabled: number
  created_at: string
  updated_at: string
  last_opened_at: string | null
}

export interface GlobalAssistantPayload {
  assistant: GlobalAssistantRow
  agent: AgentData
  session: SessionData
}

interface GlobalAssistantStore {
  assistant: GlobalAssistantRow | null
  agent: AgentData | null
  session: SessionData | null
  open: boolean
  loading: boolean
  settingTemplateIds: Record<string, boolean>
  messages: MessageData[]
  events: SessionEventData[]
  streamingMessage: StreamingMessage | null
  usage: UsageInfo | null
  turnUsage: TurnUsageInfo | null
  capabilities: SessionCapabilities
  plan: PlanEntry[]
  pendingPermissions: PermissionRequestInfo[]
  pendingElicitations: ElicitationRequestInfo[]
  hasMoreMessages: boolean
  loadingOlderMessages: boolean
  running: boolean
  unread: boolean
  error: string | null
  fileChangeDetailsByMessageId: Record<string, FileChangeDetailInfo>
  toolCallLoadingByKey: Record<string, boolean>
  toolCallErrorByKey: Record<string, string>
  turnProcessLoadingByMessageId: Record<string, boolean>
  turnProcessErrorByMessageId: Record<string, string>
  processItemLoadingByKey: Record<string, boolean>
  processItemErrorByKey: Record<string, string>

  load: () => Promise<void>
  setFromTemplate: (templateId: string) => Promise<void>
  openDrawer: () => Promise<void>
  closeDrawer: () => void
  sendPrompt: (content: string, images?: ImageAttachmentInfo[]) => void
  setModel: (modelId: string) => Promise<void>
  setMode: (modeId: string) => Promise<void>
  setConfig: (configId: string, value: string | boolean) => Promise<void>
  cancelTurn: () => Promise<void>
  respondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  respondElicitation: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => Promise<void>
  fetchMessages: () => Promise<void>
  loadOlderMessages: () => Promise<void>
  fetchEvents: () => Promise<void>
  fetchModels: () => Promise<void>
  fetchMessageProcess: (sessionId: string, messageId: string) => Promise<void>
  fetchMessageFileChanges: (sessionId: string, messageId: string) => Promise<void>
  fetchProcessItemDetail: (sessionId: string, messageId: string, itemId: string) => Promise<void>
  setupListeners: () => () => void
}

let activeSubscribedSessionId: string | null = null
let listenersSetup = false
let cleanupFn: (() => void) | null = null
let promptStartTime = 0

function currentSessionId(state: Pick<GlobalAssistantStore, 'session'>): string | null {
  return state.session?.id ?? null
}

function ensureSubscription(sessionId: string): void {
  if (activeSubscribedSessionId === sessionId) return
  if (activeSubscribedSessionId) wsClient.unsubscribe([activeSubscribedSessionId])
  activeSubscribedSessionId = sessionId
  wsClient.subscribe([sessionId])
}

function clearSubscription(): void {
  if (!activeSubscribedSessionId) return
  wsClient.unsubscribe([activeSubscribedSessionId])
  activeSubscribedSessionId = null
}

function reducedStateFromStore(state: GlobalAssistantStore) {
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

function partialFromReduced(reduced: ReturnType<typeof reducedStateFromStore>): Partial<GlobalAssistantStore> {
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
  const next: StreamingMessage = {
    ...turn,
    processBlocks: mergeProcessBlock(turn.processBlocks, block),
  }
  next.thinking = next.processBlocks
    .filter((item): item is Extract<TurnProcessBlock, { kind: 'thinking' }> => item.kind === 'thinking')
    .map((item) => item.text)
    .join('')
  next.toolCalls = next.processBlocks
    .filter((item): item is Extract<TurnProcessBlock, { kind: 'tool' }> => item.kind === 'tool')
    .map((item) => item.toolCall)
  if (block.kind === 'note' && next.finalAnswer) {
    next.finalAnswer = ''
    next.content = ''
  }
  next.stage = block.kind === 'stage' ? block.text : undefined
  return next
}

function streamingBaseForProcessItem(current: StreamingMessage | null, item: TurnProcessItemInfo, running: boolean): StreamingMessage | null {
  if (current?.id === item.message_id) return current
  if (!running) return current
  const canHandoff =
    !current ||
    current.id.startsWith('pending-') ||
    (!!current.stage && !current.finalAnswer && current.processBlocks.every((block) => block.kind === 'stage'))
  return canHandoff ? { ...(current ?? createEmptyTurn(item.message_id)), id: item.message_id } : current
}

function hasCanonicalProcessBlock(turn: StreamingMessage | null, messageId: string | undefined, data: Record<string, unknown>): boolean {
  if (!turn || !messageId || turn.id !== messageId) return false
  if (typeof data.thinking === 'string') {
    return turn.processBlocks.some((block) => block.kind === 'thinking' && block.id.startsWith('tpi-') && block.text.includes(data.thinking as string))
  }
  const toolCall = data.toolCall as ToolCallInfo | undefined
  if (toolCall?.id) {
    return turn.processBlocks.some((block) => block.kind === 'tool' && block.id.startsWith('tpi-') && block.toolCall.id === toolCall.id)
  }
  const toolCallUpdate = data.toolCallUpdate as ToolCallInfo | undefined
  if (toolCallUpdate?.id) {
    return turn.processBlocks.some((block) => block.kind === 'tool' && block.id.startsWith('tpi-') && block.toolCall.id === toolCallUpdate.id)
  }
  return false
}

function applyRealtimeUpdate(
  current: StreamingMessage | null,
  sessionId: string,
  data: Record<string, unknown>,
): StreamingMessage | null {
  const messageId = typeof data.messageId === 'string' ? data.messageId : `stream-${sessionId}-${Date.now()}`
  let turn = current
  if (
    !turn ||
    turn.done ||
    turn.id.startsWith('pending-') ||
    (!!turn.stage && !turn.finalAnswer && turn.processBlocks.every((block) => block.kind === 'stage'))
  ) {
    turn = { ...(turn ?? createEmptyTurn(messageId)), id: messageId }
  }
  if (data.contentDelta) turn = applyTurnEntry(turn, { kind: 'reply', text: String(data.contentDelta) })
  if (data.thinking) turn = applyTurnEntry(turn, { kind: 'thinking', text: String(data.thinking) })
  if (data.toolCall) turn = applyTurnEntry(turn, { kind: 'toolCall', toolCall: data.toolCall as ToolCallInfo })
  if (data.toolCallUpdate) {
    const update = data.toolCallUpdate as ToolCallInfo
    if (turn.processBlocks.some((block) => block.kind === 'tool' && block.toolCall.id === update.id) || shouldCreateToolFromUpdate(update)) {
      turn = applyTurnEntry(turn, { kind: 'toolUpdate', toolCall: update })
    }
  }
  return turn
}

function hasRunningAgentMessage(messages: MessageData[], sessionId: string): boolean {
  return messages.some((message) => message.session_id === sessionId && message.role === 'agent' && message.status === 'running')
}

function streamingFromRunningMessage(message: MessageData): StreamingMessage {
  return {
    ...createEmptyTurn(message.id),
    processBlocks: message.processBlocks ?? [],
    finalAnswer: message.finalAnswer ?? message.content,
    content: message.finalAnswer ?? message.content,
    done: false,
  }
}

function shouldLoadMessageProcess(message: MessageData | undefined): boolean {
  if (!message) return true
  const expectedCount = message.process_item_count ?? message.tool_call_count ?? 0
  if (message.status === 'running') return true
  if (!message.processBlocks) return expectedCount > 0 || !!message.has_tool_calls
  return expectedCount > message.processBlocks.filter((block) => block.kind !== 'stage').length
}

function processItemCacheKey(messageId: string, itemId: string): string {
  return `${messageId}:${itemId}`
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

async function activatePayload(
  payload: GlobalAssistantPayload | null,
  set: (partial: Partial<GlobalAssistantStore> | ((state: GlobalAssistantStore) => Partial<GlobalAssistantStore>)) => void,
  get: () => GlobalAssistantStore,
  loadCapabilities = false,
): Promise<void> {
  if (!payload) {
    clearSubscription()
    set({ assistant: null, agent: null, session: null, messages: [], events: [], streamingMessage: null, unread: false, running: false })
    return
  }
  ensureSubscription(payload.session.id)
  set({
    assistant: payload.assistant,
    agent: payload.agent,
    session: payload.session,
    error: null,
    unread: false,
  })
  await Promise.all([
    get().fetchMessages(),
    loadCapabilities ? get().fetchModels() : Promise.resolve(),
  ])
}

export const useGlobalAssistantStore = create<GlobalAssistantStore>((set, get) => ({
  assistant: null,
  agent: null,
  session: null,
  open: false,
  loading: false,
  settingTemplateIds: {},
  messages: [],
  events: [],
  streamingMessage: null,
  usage: null,
  turnUsage: null,
  capabilities: { ...defaultCaps },
  plan: [],
  pendingPermissions: [],
  pendingElicitations: [],
  hasMoreMessages: false,
  loadingOlderMessages: false,
  running: false,
  unread: false,
  error: null,
  fileChangeDetailsByMessageId: {},
  toolCallLoadingByKey: {},
  toolCallErrorByKey: {},
  turnProcessLoadingByMessageId: {},
  turnProcessErrorByMessageId: {},
  processItemLoadingByKey: {},
  processItemErrorByKey: {},

  load: async () => {
    set({ loading: true })
    try {
      const payload = await wsClient.request({ type: 'globalAssistant.get' }) as GlobalAssistantPayload | null
      await activatePayload(payload, set, get)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  },

  setFromTemplate: async (templateId) => {
    set((state) => ({ settingTemplateIds: { ...state.settingTemplateIds, [templateId]: true }, error: null }))
    try {
      const payload = await wsClient.request({ type: 'globalAssistant.setTemplate', templateId }) as GlobalAssistantPayload
      await activatePayload(payload, set, get, true)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      throw err
    } finally {
      set((state) => ({ settingTemplateIds: withoutKey(state.settingTemplateIds, templateId) }))
    }
  },

  openDrawer: async () => {
    set({ open: true, unread: false })
    if (!get().assistant) await get().load()
    if (get().assistant) {
      void wsClient.request({ type: 'globalAssistant.touch' }).catch(() => undefined)
      void get().fetchModels()
    }
  },

  closeDrawer: () => set({ open: false }),

  sendPrompt: (content, images) => {
    const sid = currentSessionId(get())
    if (!sid || get().running) return
    const trimmed = content.trim()
    if (!trimmed && !images?.length) return
    const clientMessageId = `msg-local-${Date.now()}`
    const msg: Record<string, unknown> = { type: 'prompt', sessionId: sid, content: trimmed, clientMessageId }
    if (images?.length) msg.images = images
    wsClient.send(msg)
    promptStartTime = Date.now()
    set((state) => ({
      messages: [
        ...state.messages,
        normalizeMessage({
          id: clientMessageId,
          session_id: sid,
          role: 'human',
          content: trimmed,
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: images?.length ? JSON.stringify(images) : null,
          file_changes_json: null,
          timestamp: new Date().toISOString(),
        }),
      ],
      streamingMessage: applyTurnEntry(createEmptyTurn(`pending-${sid}-${Date.now()}`), { kind: 'stage', text: '正在准备 Agent...' }),
      turnUsage: null,
      running: true,
      unread: false,
    }))
  },

  setModel: async (modelId) => {
    const sid = currentSessionId(get())
    if (!sid) return
    await wsClient.request({ type: 'session.setModel', sessionId: sid, modelId })
    set((state) => ({ capabilities: { ...state.capabilities, currentModelId: modelId } }))
  },

  setMode: async (modeId) => {
    const sid = currentSessionId(get())
    if (!sid) return
    await wsClient.request({ type: 'session.setMode', sessionId: sid, modeId })
    set((state) => ({ capabilities: { ...state.capabilities, currentModeId: modeId } }))
  },

  setConfig: async (configId, value) => {
    const sid = currentSessionId(get())
    if (!sid) return
    await wsClient.request({ type: 'session.setConfig', sessionId: sid, configId, value })
  },

  cancelTurn: async () => {
    const sid = currentSessionId(get())
    if (!sid) return
    await wsClient.request({ type: 'session.cancel', sessionId: sid })
  },

  respondPermission: async (requestId, optionId, cancelled) => {
    const sid = currentSessionId(get())
    if (!sid) return
    await wsClient.request({ type: 'permission.respond', sessionId: sid, permissionRequestId: requestId, optionId, cancelled })
  },

  respondElicitation: async (requestId, action, content) => {
    const sid = currentSessionId(get())
    if (!sid) return
    await wsClient.request({ type: 'elicitation.respond', sessionId: sid, elicitationRequestId: requestId, action, content })
  },

  fetchMessages: async () => {
    const sid = currentSessionId(get())
    if (!sid) return
    const rawMessages = await wsClient.request({ type: 'sessions.messages', sessionId: sid, limit: CHAT_MESSAGE_PAGE_SIZE })
    const serverMessages = Array.isArray(rawMessages) ? rawMessages as MessageData[] : []
    if (sid !== currentSessionId(get())) return
    set((state) => {
      const messages = mergeMessagesForSession(serverMessages, state.messages, sid)
      const runningMessage = messages.filter((message) => message.session_id === sid && message.role === 'agent' && message.status === 'running').at(-1)
      const hasRunning = hasRunningAgentMessage(messages, sid)
      return {
        messages,
        streamingMessage: runningMessage && !turnHasVisibleContent(state.streamingMessage)
          ? streamingFromRunningMessage(runningMessage)
          : state.streamingMessage,
        running: hasRunning || state.running,
        hasMoreMessages: serverMessages.length >= CHAT_MESSAGE_PAGE_SIZE,
      }
    })
    const runningMessage = get().messages.filter((message) => message.session_id === sid && message.role === 'agent' && message.status === 'running').at(-1)
    if (runningMessage) void get().fetchMessageProcess(sid, runningMessage.id)
    if (get().messages.filter((message) => message.session_id === sid).length === 0) void get().fetchEvents()
  },

  loadOlderMessages: async () => {
    const sid = currentSessionId(get())
    if (!sid || get().loadingOlderMessages || !get().hasMoreMessages) return
    const oldest = get().messages.filter((message) => message.session_id === sid).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0]
    if (!oldest) return
    set({ loadingOlderMessages: true })
    try {
      const rawMessages = await wsClient.request({ type: 'sessions.messages', sessionId: sid, limit: CHAT_MESSAGE_PAGE_SIZE, before: oldest.timestamp })
      const olderMessages = Array.isArray(rawMessages) ? rawMessages as MessageData[] : []
      if (sid !== currentSessionId(get())) return
      set((state) => ({
        messages: mergeMessagesForSession(olderMessages, state.messages, sid),
        hasMoreMessages: olderMessages.length >= CHAT_MESSAGE_PAGE_SIZE,
      }))
    } finally {
      set({ loadingOlderMessages: false })
    }
  },

  fetchEvents: async () => {
    const sid = currentSessionId(get())
    if (!sid) return
    const rawEvents = await wsClient.request({ type: 'sessions.events', sessionId: sid, limit: 1000 })
    const events = Array.isArray(rawEvents) ? rawEvents as SessionEventData[] : []
    if (sid !== currentSessionId(get())) return
    const reduced = reduceVisibleEvents(events, get().messages.length > 0, get().running)
    set((state) => ({
      events,
      usage: reduced.usage,
      turnUsage: reduced.turnUsage,
      capabilities: mergeCapabilities(state.capabilities, reduced.capabilities),
      plan: reduced.plan,
      pendingPermissions: reduced.pendingPermissions,
      pendingElicitations: reduced.pendingElicitations,
      streamingMessage: reduced.streamingMessage ?? state.streamingMessage,
    }))
  },

  fetchModels: async () => {
    const sid = currentSessionId(get())
    if (!sid) return
    const incoming = await wsClient.request({ type: 'session.getModels', sessionId: sid }) as Partial<SessionCapabilities>
    set((state) => ({
      capabilities: {
        ...state.capabilities,
        models: incoming.models || state.capabilities.models,
        currentModelId: incoming.currentModelId || state.capabilities.currentModelId,
        modes: incoming.modes || state.capabilities.modes,
        currentModeId: incoming.currentModeId || state.capabilities.currentModeId,
        supportsImages: incoming.supportsImages ?? state.capabilities.supportsImages,
        supportsAudio: incoming.supportsAudio ?? state.capabilities.supportsAudio,
        configOptions: incoming.configOptions || state.capabilities.configOptions,
        commands: incoming.commands || state.capabilities.commands,
        sessionInfo: incoming.sessionInfo || state.capabilities.sessionInfo,
      },
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
      if (sessionId !== currentSessionId(get())) return
      let turn = turnFromProcessItems(messageId, items)
      if (items.length === 0 && existing?.has_tool_calls) {
        const events = await wsClient.request({ type: 'sessions.messageEvents', sessionId, messageId }) as SessionEventData[]
        if (sessionId !== currentSessionId(get())) return
        turn = turnFromEvents(messageId, events)
      }
      set((state) => ({
        messages: state.messages.map((message) => message.id === messageId && message.session_id === sessionId
          ? {
              ...message,
              processBlocks: turn.processBlocks,
              finalAnswer: turn.finalAnswer || message.content,
              parsedToolCalls: turn.toolCalls.length > 0 ? turn.toolCalls : message.parsedToolCalls,
            }
          : message),
        streamingMessage: existing?.status === 'running'
          ? { ...turn, finalAnswer: existing.content, content: existing.content, done: false }
          : state.streamingMessage,
        turnProcessLoadingByMessageId: { ...state.turnProcessLoadingByMessageId, [messageId]: false },
      }))
    } catch (err) {
      set((state) => ({
        turnProcessLoadingByMessageId: { ...state.turnProcessLoadingByMessageId, [messageId]: false },
        turnProcessErrorByMessageId: { ...state.turnProcessErrorByMessageId, [messageId]: err instanceof Error ? err.message : String(err) },
      }))
    }
  },

  fetchMessageFileChanges: async (sessionId, messageId) => {
    const key = `file:${messageId}`
    if (get().fileChangeDetailsByMessageId[messageId] || get().toolCallLoadingByKey[key]) return
    set((state) => ({
      toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [key]: true },
      toolCallErrorByKey: { ...state.toolCallErrorByKey, [key]: '' },
    }))
    try {
      const detail = await wsClient.request({ type: 'sessions.messageFileChanges', sessionId, messageId }) as FileChangeDetailInfo
      if (sessionId !== currentSessionId(get())) return
      set((state) => ({
        fileChangeDetailsByMessageId: { ...state.fileChangeDetailsByMessageId, [messageId]: detail },
        toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [key]: false },
      }))
    } catch (err) {
      set((state) => ({
        toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [key]: false },
        toolCallErrorByKey: { ...state.toolCallErrorByKey, [key]: err instanceof Error ? err.message : String(err) },
      }))
    }
  },

  fetchProcessItemDetail: async (sessionId, messageId, itemId) => {
    const key = processItemCacheKey(messageId, itemId)
    if (get().processItemLoadingByKey[key]) return
    set((state) => ({
      processItemLoadingByKey: { ...state.processItemLoadingByKey, [key]: true },
      processItemErrorByKey: { ...state.processItemErrorByKey, [key]: '' },
    }))
    try {
      const item = await wsClient.request({ type: 'sessions.processItemDetail', sessionId, messageId, itemId }) as TurnProcessItemInfo
      if (sessionId !== currentSessionId(get())) return
      const detailBlock = turnFromProcessItems(messageId, [item]).processBlocks[0]
      if (!detailBlock) return
      set((state) => ({
        messages: state.messages.map((message) => message.id === messageId && message.session_id === sessionId
          ? { ...message, processBlocks: mergeProcessBlock(message.processBlocks || [], detailBlock) }
          : message),
        streamingMessage: state.streamingMessage?.id === messageId
          ? mergeProcessBlockIntoStreaming(state.streamingMessage, detailBlock)
          : state.streamingMessage,
        processItemLoadingByKey: withoutKey(state.processItemLoadingByKey, key),
        processItemErrorByKey: withoutKey(state.processItemErrorByKey, key),
      }))
    } catch (err) {
      set((state) => ({
        processItemLoadingByKey: withoutKey(state.processItemLoadingByKey, key),
        processItemErrorByKey: { ...state.processItemErrorByKey, [key]: err instanceof Error ? err.message : String(err) },
      }))
    }
  },

  setupListeners: () => {
    if (listenersSetup && cleanupFn) return cleanupFn
    const offs: (() => void)[] = []

    offs.push(wsClient.on('session:event', (msg) => {
      const sid = String(msg.sessionId || '')
      if (sid !== currentSessionId(get())) return
      const event = msg.event as SessionEventData
      if (event.type.startsWith('lifecycle.') && !shouldShowLifecycleStage(event.type)) return
      if (['message.chunk', 'thinking.chunk', 'tool.call', 'tool.update', 'message.done'].includes(event.type)) return
      set((state) => {
        const events = [...state.events.filter((item) => item.id !== event.id), event].sort((a, b) => a.sequence - b.sequence).slice(-1000)
        return { events, ...partialFromReduced(applySessionEvent(reducedStateFromStore(state), event)) }
      })
    }))

    offs.push(wsClient.on('session:process_item', (msg) => {
      const sid = String(msg.sessionId || '')
      if (sid !== currentSessionId(get())) return
      const item = msg.item as TurnProcessItemInfo
      const block = turnFromProcessItems(item.message_id, [item]).processBlocks[0]
      if (!block) return
      set((state) => {
        const streamingBase = streamingBaseForProcessItem(state.streamingMessage, item, state.running)
        return {
          streamingMessage: streamingBase?.id === item.message_id ? mergeProcessBlockIntoStreaming(streamingBase, block) : state.streamingMessage,
          messages: state.messages.map((message) => {
            if (message.id !== item.message_id || message.session_id !== sid) return message
            const processBlocks = mergeProcessBlock(message.processBlocks || [], block)
            return { ...message, processBlocks, process_item_count: processBlocks.filter((processBlock) => processBlock.kind !== 'stage').length }
          }),
        }
      })
    }))

    offs.push(wsClient.on('session:update', (msg) => {
      const sid = String(msg.sessionId || '')
      if (sid !== currentSessionId(get())) return
      const data = msg.data as Record<string, unknown>
      if (typeof data.eventType === 'string' && data.eventType.startsWith('lifecycle.')) {
        if (!shouldShowLifecycleStage(data.eventType)) return
        set((state) => ({
          streamingMessage: applyTurnEntry(state.streamingMessage ?? createEmptyTurn(String(data.messageId || `stream-${sid}-${Date.now()}`)), {
            kind: 'stage',
            text: String(data.content || ''),
          }),
        }))
        return
      }
      if (data.eventType === 'permission.result' || data.eventType === 'elicitation.result') return
      if (data.usage) { set({ usage: data.usage as UsageInfo }); return }
      if (data.plan) { set({ plan: data.plan as PlanEntry[] }); return }
      if (data.configOptions) { set((state) => ({ capabilities: capabilitiesFromConfig(state.capabilities, data.configOptions as ConfigOptionInfo[]) })); return }
      if (data.commands) { set((state) => ({ capabilities: { ...state.capabilities, commands: data.commands as AvailableCommandInfo[] } })); return }
      if (data.permissionRequest) {
        const req = data.permissionRequest as PermissionRequestInfo
        set((state) => ({ pendingPermissions: [...state.pendingPermissions.filter((item) => item.id !== req.id), req] }))
        return
      }
      if (data.elicitationRequest) {
        const req = data.elicitationRequest as ElicitationRequestInfo
        set((state) => ({ pendingElicitations: [...state.pendingElicitations.filter((item) => item.id !== req.id), req] }))
        return
      }
      if (data.contentDelta || data.thinking || data.toolCall || data.toolCallUpdate) {
        const messageId = typeof data.messageId === 'string' ? data.messageId : undefined
        if (!data.contentDelta && hasCanonicalProcessBlock(get().streamingMessage, messageId, data)) return
        set((state) => ({ streamingMessage: applyRealtimeUpdate(state.streamingMessage, sid, data), running: true }))
      }
    }))

    offs.push(wsClient.on('session:done', (msg) => {
      const sid = String(msg.sessionId || '')
      if (sid !== currentSessionId(get())) return
      const turnUsage = msg.turnUsage as TurnUsageInfo | undefined
      const elapsed = promptStartTime > 0 ? Math.round((Date.now() - promptStartTime) / 1000) : undefined
      const cost = get().usage?.costAmount
      const turnStats = turnUsage ? JSON.stringify({ ...turnUsage, costAmount: cost, elapsedSeconds: elapsed }) : null
      promptStartTime = 0
      const streaming = get().streamingMessage
      if (turnHasFinalizableContent(streaming)) {
        const finalizedToolCalls = streaming.toolCalls.map((toolCall) =>
          toolCall.status === 'pending' || toolCall.status === 'in_progress' ? { ...toolCall, status: 'completed' } : toolCall,
        )
        const message = normalizeMessage({
          id: streaming.id,
          session_id: sid,
          role: 'agent',
          content: streaming.finalAnswer,
          thinking: streaming.thinking || null,
          tool_calls_json: finalizedToolCalls.length > 0 ? JSON.stringify(finalizedToolCalls) : null,
          decision_json: turnStats,
          attachments_json: null,
          file_changes_json: null,
          timestamp: new Date().toISOString(),
          processBlocks: processBlocksForCompletedTurn(streaming),
          finalAnswer: streaming.finalAnswer,
        })
        set((state) => ({
          messages: appendFinalizedMessage(state.messages, message),
          streamingMessage: null,
          turnUsage: turnUsage || state.turnUsage,
          plan: clearPlanOnTurnDone(),
          running: false,
          unread: !state.open,
        }))
      } else {
        const error = typeof msg.error === 'string' ? msg.error : ''
        const finalMessage = error
          ? buildErrorAgentMessage(sid, String(msg.messageId || `error-${Date.now()}`), error)
          : buildCompletedAgentMessage(sid, get().events, turnUsage, cost, elapsed)
        set((state) => ({
          messages: finalMessage ? appendFinalizedMessage(state.messages, finalMessage) : state.messages,
          streamingMessage: null,
          turnUsage: turnUsage || state.turnUsage,
          plan: clearPlanOnTurnDone(),
          running: false,
          unread: !state.open,
        }))
      }
      void get().fetchMessages()
    }))

    offs.push(wsClient.on('session:capabilities', (msg) => {
      const sid = String(msg.sessionId || '')
      if (sid !== currentSessionId(get())) return
      const incoming = msg.capabilities as SessionCapabilities
      set((state) => ({ capabilities: mergeCapabilities(state.capabilities, incoming) }))
    }))

    offs.push(wsClient.on('session:activity', (msg) => {
      const sid = String(msg.sessionId || '')
      if (sid !== currentSessionId(get())) return
      const running = msg.state === 'running'
      set((state) => ({
        running,
        unread: running ? false : !state.open,
        streamingMessage: running ? state.streamingMessage : null,
      }))
      if (!running && get().open) void get().fetchMessages()
    }))

    listenersSetup = true
    cleanupFn = () => {
      offs.forEach((off) => off())
      listenersSetup = false
      cleanupFn = null
    }
    return cleanupFn
  },
}))

function reduceVisibleEvents(events: SessionEventData[], hasMessages: boolean, running: boolean) {
  const mirroredTypes = new Set(['message.chunk', 'thinking.chunk', 'tool.call', 'tool.update', 'message.done'])
  const reduced = hasMessages
    ? applyEventList(events.filter((event) => !mirroredTypes.has(event.type)))
    : applyEventList(events)
  const active = hasMessages ? applyEventList(events).streamingMessage : reduced.streamingMessage
  return {
    ...reduced,
    streamingMessage: running ? active : reduced.streamingMessage,
  }
}

function applyEventList(events: SessionEventData[]) {
  return events.sort((a, b) => a.sequence - b.sequence).reduce(applySessionEvent, {
    streamingMessage: null,
    usage: null,
    turnUsage: null,
    capabilities: { ...defaultCaps },
    plan: [],
    pendingPermissions: [],
    pendingElicitations: [],
  })
}
