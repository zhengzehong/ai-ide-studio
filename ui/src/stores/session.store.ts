import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import {
  applySessionEvent,
  buildErrorAgentMessage,
  buildChatTimelineFromEvents,
  buildCompletedAgentMessage,
  capabilitiesFromConfig,
  clearPlanOnTurnDone,
  defaultCaps,
  groupChatTimelineItems,
  appendFinalizedMessage,
  mergeCapabilities,
  mergeMessagesForSession,
  normalizeMessage,
  shouldCreateToolFromUpdate,
  reduceSessionEvents,
  shouldShowLifecycleStage,
  type AvailableCommandInfo,
  type ChatTimelineItem,
  type ChatTimelineGroup,
  type ChatTimelineMessageItem,
  type ChatTimelineToolItem,
  type ConfigOptionInfo,
  type ElicitationRequestInfo,
  type FileChangeDetailInfo,
  type FileChangeSummaryInfo,
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
  type TurnProcessItemInfo,
  type TurnUsageInfo,
  type UsageInfo,
} from './session-events'
import { StreamingBuffer } from './streaming-buffer'
import { applyTurnEntry, createEmptyTurn, processBlocksForCompletedTurn, turnFromEvents, turnFromProcessItems, turnHasFinalizableContent, turnHasVisibleContent, type TurnProcessBlock } from './turn-blocks'
import {
  inferRunningSessions,
  isSessionUnreadByTimestamps,
  removeSessionIndicator,
  type SessionIndicatorStateMap,
} from '../utils/session-indicators'

const COPYING_STAGE = '正在复制会话...'

const CHAT_MESSAGE_PAGE_SIZE = 20

export type {
  AvailableCommandInfo,
  ChatTimelineItem,
  ChatTimelineGroup,
  ChatTimelineMessageItem,
  ChatTimelineToolItem,
  ConfigOptionInfo,
  ElicitationRequestInfo,
  FileChangeDetailInfo,
  FileChangeSummaryInfo,
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
  activity_state?: 'running' | 'idle'
  project_id?: string | null; title?: string | null; updated_at?: string | null; last_message_at?: string | null; last_read_at?: string | null; archived_at?: string | null; deleted_at?: string | null; sort_order?: number | null
  is_primary?: number | boolean
}

export interface LocalSessionCandidateInfo {
  runtime: 'codex' | 'claude'
  sessionId: string
  path: string
  label: string
  updatedAt: string
  cwd?: string
}

export interface ImportLocalSessionInput {
  projectId?: string
  jsonlPath?: string
  externalSessionId?: string
  sourcePath?: string
  runtime?: 'codex' | 'claude'
  cwd?: string
  title?: string
}

export interface LocalSessionImportResult {
  session: SessionData
  warning: string | null
  candidate: LocalSessionCandidateInfo
}

interface SessionCache {
  messages: MessageData[]; events: SessionEventData[]; usage: UsageInfo | null; turnUsage: TurnUsageInfo | null; capabilities: SessionCapabilities; plan: PlanEntry[]
  pendingPermissions: PermissionRequestInfo[]; pendingElicitations: ElicitationRequestInfo[]; streamingMessage: StreamingMessage | null
}

interface SessionStore {
  sessions: SessionData[]; currentSessionId: string | null; messages: MessageData[]; events: SessionEventData[]
  streamingMessage: StreamingMessage | null; usage: UsageInfo | null; turnUsage: TurnUsageInfo | null
  capabilities: SessionCapabilities; plan: PlanEntry[]; pendingPermissions: PermissionRequestInfo[]; pendingElicitations: ElicitationRequestInfo[]; loading: boolean
  copyingTargetSessionIds: Record<string, string>
  copyingSourceSessionIds: Record<string, string>
  lastCopyError: { sourceSessionId: string; targetSessionId: string; message: string } | null
  hasMoreMessagesBySession: Record<string, boolean>
  loadingOlderMessagesBySession: Record<string, boolean>
  toolCallSummariesByMessageId: Record<string, ToolCallSummaryInfo[]>
  toolCallDetailsByKey: Record<string, ToolCallDetailInfo>
  fileChangeDetailsByMessageId: Record<string, FileChangeDetailInfo>
  toolCallLoadingByKey: Record<string, boolean>
  toolCallErrorByKey: Record<string, string>
  turnProcessLoadingByMessageId: Record<string, boolean>
  turnProcessErrorByMessageId: Record<string, string>
  processItemLoadingByKey: Record<string, boolean>
  processItemErrorByKey: Record<string, string>
  runningSessionIds: SessionIndicatorStateMap
  unreadSessionIds: SessionIndicatorStateMap
  staleSessionIds: SessionIndicatorStateMap

  fetchSessions: (agentId?: string, projectId?: string) => Promise<void>
  fetchMessages: (sessionId: string) => Promise<void>
  loadOlderMessages: (sessionId: string) => Promise<void>
  fetchEvents: (sessionId: string) => Promise<void>
  createSession: (agentId: string, taskId?: string, projectId?: string) => Promise<SessionData>
  copySession: (sessionId: string) => Promise<SessionData>
  listLocalImportCandidates: (agentId: string, projectId?: string) => Promise<LocalSessionCandidateInfo[]>
  importLocalSession: (agentId: string, input: ImportLocalSessionInput) => Promise<LocalSessionImportResult>
  renameSession: (sessionId: string, title: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  closeSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  reorderSessions: (projectId: string, agentId: string, sessionIds: string[]) => Promise<SessionData[]>
  clearCopyError: () => void
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
  fetchMessageFileChanges: (sessionId: string, messageId: string) => Promise<void>
  fetchMessageProcess: (sessionId: string, messageId: string) => Promise<void>
  fetchProcessItemDetail: (sessionId: string, messageId: string, itemId: string) => Promise<void>
  setupListeners: () => () => void
}

let listenersSetup = false
let cleanupFn: (() => void) | null = null
let promptStartTime = 0
let lastStreamingSnapshot: StreamingMessage | null = null
let sessionListRequestSeq = 0
const CURRENT_SESSION_STORAGE_KEY = 'ai-ide-current-session-id'

function localStorageRef(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readStoredSessionId(): string | null {
  return localStorageRef()?.getItem(CURRENT_SESSION_STORAGE_KEY) ?? null
}

function writeStoredSessionId(sessionId: string | null): void {
  const storage = localStorageRef()
  if (!storage) return
  if (sessionId) storage.setItem(CURRENT_SESSION_STORAGE_KEY, sessionId)
  else storage.removeItem(CURRENT_SESSION_STORAGE_KEY)
}

let activeSessionsProjectId: string | null = null
const sessionCaches = new Map<string, SessionCache>()
const eventCursorBySession = new Map<string, number>()
const streamingBuffer = new StreamingBuffer()
let streamingFlushTimer: ReturnType<typeof setTimeout> | null = null
const mirroredRealtimeEventTypes = new Set(['message.chunk', 'thinking.chunk', 'tool.call', 'tool.update', 'message.done'])

function normalizeActiveTurn(message: StreamingMessage | null | undefined): StreamingMessage | null {
  if (!message) return null
  if (Array.isArray(message.processBlocks)) return message
  let next = createEmptyTurn(message.id)
  if (message.stage) next = applyTurnEntry(next, { kind: 'stage', text: message.stage })
  if (message.thinking) next = applyTurnEntry(next, { kind: 'thinking', text: message.thinking })
  for (const toolCall of message.toolCalls ?? []) next = applyTurnEntry(next, { kind: 'toolCall', toolCall })
  if (message.content) next = applyTurnEntry(next, { kind: 'reply', text: message.content })
  if (message.done) next = applyTurnEntry(next, { kind: 'done' })
  return next
}


function hasVisibleStreamingState(message: StreamingMessage | null): boolean {
  return turnHasVisibleContent(message)
}

function shouldRecoverStreamingMessage(recovered: StreamingMessage | null, messages: MessageData[]): boolean {
  return !!recovered && !messages.some((message) => message.role === 'agent' && message.id === recovered.id)
}

function hasAgentMessageAfterLatestHuman(messages: MessageData[], sessionId: string): boolean {
  const sessionMessages = messages
    .filter((message) => message.session_id === sessionId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  let latestHumanIndex = -1
  for (let i = sessionMessages.length - 1; i >= 0; i -= 1) {
    if (sessionMessages[i].role === 'human') {
      latestHumanIndex = i
      break
    }
  }
  if (latestHumanIndex < 0) return sessionMessages.some((message) => message.role === 'agent')
  return sessionMessages.slice(latestHumanIndex + 1).some((message) => message.role === 'agent')
}

function shouldClearStreamingAfterMessageLoad(
  sessionId: string,
  messages: MessageData[],
  streamingMessage: StreamingMessage | null,
  runningSessionIds: SessionIndicatorStateMap,
  staleSessionIds: SessionIndicatorStateMap,
): boolean {
  if (!streamingMessage) return false
  if (messages.some((message) => message.session_id === sessionId && message.role === 'agent' && message.id === streamingMessage.id && message.status !== 'running')) return true
  return !runningSessionIds[sessionId] && (!!staleSessionIds[sessionId] || hasAgentMessageAfterLatestHuman(messages, sessionId))
}

function selectRecoveredStreamingMessage(
  current: StreamingMessage | null,
  recovered: StreamingMessage | null,
  messages: MessageData[],
  allowRecovery: boolean,
): StreamingMessage | null {
  if (!allowRecovery) return null
  if (!shouldRecoverStreamingMessage(recovered, messages)) return current
  if (!hasVisibleStreamingState(current)) return recovered
  if (!current || current.id.startsWith('pending-')) return recovered
  return current
}


function reconcileRunningSessionIndicators(
  current: SessionIndicatorStateMap,
  sessions: SessionData[],
): SessionIndicatorStateMap {
  const next = { ...current }
  for (const session of sessions) delete next[session.id]
  return { ...next, ...inferRunningSessions(sessions) }
}

function hasRunningAgentMessage(messages: MessageData[], sessionId: string): boolean {
  return messages.some((message) => message.session_id === sessionId && message.role === 'agent' && message.status === 'running')
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

function streamingFromRunningMessage(message: MessageData): StreamingMessage {
  const processBlocks = message.processBlocks ?? []
  return {
    ...createEmptyTurn(message.id),
    processBlocks,
    thinking: processBlocks
      .filter((block): block is Extract<TurnProcessBlock, { kind: 'thinking' }> => block.kind === 'thinking')
      .map((block) => block.text)
      .join(''),
    toolCalls: processBlocks
      .filter((block): block is Extract<TurnProcessBlock, { kind: 'tool' }> => block.kind === 'tool')
      .map((block) => block.toolCall),
    finalAnswer: message.finalAnswer ?? message.content,
    content: message.finalAnswer ?? message.content,
    done: false,
  }
}

function removeSessionIndicators(
  source: SessionIndicatorStateMap,
  sessionIds: string[],
): SessionIndicatorStateMap {
  let next = source
  for (const sessionId of sessionIds) next = removeSessionIndicator(next, sessionId)
  return next
}

function applySessionActivity(
  runningSessionIds: SessionIndicatorStateMap,
  unreadSessionIds: SessionIndicatorStateMap,
  staleSessionIds: SessionIndicatorStateMap,
  sessionId: string,
  state: 'running' | 'idle',
  currentSessionId: string | null,
): { runningSessionIds: SessionIndicatorStateMap; unreadSessionIds: SessionIndicatorStateMap; staleSessionIds: SessionIndicatorStateMap } {
  const running = { ...runningSessionIds }
  const unread = { ...unreadSessionIds }
  const stale = { ...staleSessionIds }
  if (state === 'running') {
    running[sessionId] = true
    delete unread[sessionId]
    delete stale[sessionId]
  } else {
    delete running[sessionId]
    stale[sessionId] = true
    if (currentSessionId !== sessionId) unread[sessionId] = true
  }
  return { runningSessionIds: running, unreadSessionIds: unread, staleSessionIds: stale }
}

function clearCachedStreaming(sessionId: string): void {
  const cache = sessionCaches.get(sessionId)
  if (!cache?.streamingMessage) return
  sessionCaches.set(sessionId, { ...cache, streamingMessage: null })
}

function saveCache(sessionId: string, s: Pick<SessionStore, 'messages' | 'events' | 'usage' | 'turnUsage' | 'capabilities' | 'plan' | 'pendingPermissions' | 'pendingElicitations' | 'streamingMessage'>) {
  sessionCaches.set(sessionId, {
    messages: [...s.messages],
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

async function markSessionReadOnServer(sessionId: string): Promise<void> {
  try {
    await wsClient.request({ type: 'sessions.markRead', sessionId })
  } catch {
    // Best-effort: server-side last_read_at will catch up on next fetchSessions
  }
}

function toolDetailCacheKey(messageId: string, toolCallId: string): string {
  return `${messageId}:${toolCallId}`
}

function processItemCacheKey(messageId: string, itemId: string): string {
  return `${messageId}:${itemId}`
}

function withoutRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
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
    const cur = normalizeActiveTurn(state.streamingMessage)
    let up: StreamingMessage = cur ? { ...cur, processBlocks: cur.processBlocks.map(block => block.kind === 'tool' ? { ...block, toolCall: { ...block.toolCall } } : { ...block }), toolCalls: [...cur.toolCalls] } : createEmptyTurn(String(snapshot.messageId || `stream-${sid}-${Date.now()}`))
    if (snapshot.messageId && (up.id.startsWith('pending-') || !turnHasVisibleContent(up) || (!!up.stage && !up.finalAnswer && up.processBlocks.every(block => block.kind === 'stage')))) {
      up = { ...up, id: snapshot.messageId }
    }
    for (const entry of snapshot.entries) {
      if (entry.kind === 'toolUpdate' && !up.processBlocks.some(block => block.kind === 'tool' && block.toolCall.id === entry.toolCall.id) && !shouldCreateToolFromUpdate(entry.toolCall)) continue
      up = applyTurnEntry(up, entry)
    }
    lastStreamingSnapshot = up
    return { streamingMessage: up }
  })
  const currentSessionId = get().currentSessionId
  if (currentSessionId) saveCache(currentSessionId, get())
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
  const normalizedTurn = normalizeActiveTurn(turn) ?? createEmptyTurn(turn.id)
  const next: StreamingMessage = {
    ...normalizedTurn,
    processBlocks: mergeProcessBlock(normalizedTurn.processBlocks, block),
  }
  next.thinking = next.processBlocks
    .filter((processBlock): processBlock is Extract<TurnProcessBlock, { kind: 'thinking' }> => processBlock.kind === 'thinking')
    .map((processBlock) => processBlock.text)
    .join('')
  next.toolCalls = next.processBlocks
    .filter((processBlock): processBlock is Extract<TurnProcessBlock, { kind: 'tool' }> => processBlock.kind === 'tool')
    .map((processBlock) => processBlock.toolCall)
  if (block.kind === 'note' && next.finalAnswer) {
    next.finalAnswer = ''
    next.content = ''
  }
  if (block.kind === 'stage') {
    next.stage = block.text
  } else {
    next.stage = undefined
  }
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

function scheduleStreamingFlush(set: (partial: Partial<SessionStore> | ((state: SessionStore) => Partial<SessionStore>)) => void, get: () => SessionStore): void {
  if (streamingFlushTimer) return
  streamingFlushTimer = setTimeout(() => {
    streamingFlushTimer = null
    flushStreamingBuffer(set, get)
  }, 50)
}

function isCopyingSession(session?: Partial<Pick<SessionData, 'stage' | 'acp_session_id'>> | null): boolean {
  return !!session && session.stage === COPYING_STAGE && !session.acp_session_id
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function reconcileCopyingSessions(
  sessions: SessionData[],
  currentTargets: Record<string, string>,
): { copyingTargetSessionIds: Record<string, string>; copyingSourceSessionIds: Record<string, string> } {
  const copyingTargetSessionIds = Object.fromEntries(
    sessions.filter((session) => isCopyingSession(session)).map((session) => [session.id, currentTargets[session.id] ?? '']),
  )
  const copyingSourceSessionIds = Object.fromEntries(
    Object.entries(copyingTargetSessionIds)
      .filter(([, sourceSessionId]) => !!sourceSessionId)
      .map(([targetSessionId, sourceSessionId]) => [sourceSessionId, targetSessionId]),
  )
  return { copyingTargetSessionIds, copyingSourceSessionIds }
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [], currentSessionId: null, messages: [], events: [], streamingMessage: null,
  usage: null, turnUsage: null, capabilities: { ...defaultCaps }, plan: [], pendingPermissions: [], pendingElicitations: [], loading: false,
  copyingTargetSessionIds: {}, copyingSourceSessionIds: {}, lastCopyError: null,
  hasMoreMessagesBySession: {}, loadingOlderMessagesBySession: {},
  toolCallSummariesByMessageId: {}, toolCallDetailsByKey: {}, fileChangeDetailsByMessageId: {}, toolCallLoadingByKey: {}, toolCallErrorByKey: {},
  turnProcessLoadingByMessageId: {}, turnProcessErrorByMessageId: {}, processItemLoadingByKey: {}, processItemErrorByKey: {},
  runningSessionIds: {}, unreadSessionIds: {}, staleSessionIds: {},

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
      const sessions = scopedProjectId ? data.filter((session) => session.project_id === scopedProjectId) : data
      const runningSessions = Object.keys(inferRunningSessions(sessions))
      set((state) => {
        const serverUnread: SessionIndicatorStateMap = {}
        for (const session of sessions) {
          if (state.currentSessionId === session.id) continue
          if (isSessionUnreadByTimestamps(session)) serverUnread[session.id] = true
        }
        const mergedUnread: SessionIndicatorStateMap = { ...state.unreadSessionIds, ...serverUnread }
        const unreadAfterRunning = removeSessionIndicators(mergedUnread, runningSessions)
        return {
          sessions,
          ...reconcileCopyingSessions(sessions, state.copyingTargetSessionIds),
          runningSessionIds: reconcileRunningSessionIndicators(state.runningSessionIds, sessions),
          unreadSessionIds: unreadAfterRunning,
          staleSessionIds: removeSessionIndicators(state.staleSessionIds, runningSessions),
          loading: false,
        }
      })
    } catch {
      if (requestSeq === sessionListRequestSeq) set({ loading: false })
    }
  },

  fetchMessages: async (sessionId) => {
    try {
      const serverMessages = await wsClient.request({ type: 'sessions.messages', sessionId, limit: CHAT_MESSAGE_PAGE_SIZE }) as MessageData[]
      if (sessionId !== get().currentSessionId) return
      set(state => {
        const messages = mergeMessagesForSession(serverMessages, state.messages, sessionId)
        const shouldClearStreaming = shouldClearStreamingAfterMessageLoad(
          sessionId,
          messages,
          state.streamingMessage,
          state.runningSessionIds,
          state.staleSessionIds,
        )
        const hasRunning = hasRunningAgentMessage(messages, sessionId)
        const running = messages
          .filter((message) => message.session_id === sessionId && message.role === 'agent' && message.status === 'running')
          .at(-1)
        const shouldRestoreRunning = !!running && (
          state.streamingMessage?.id !== running.id || !hasVisibleStreamingState(state.streamingMessage)
        )
        const shouldConfirmDoneState = !!state.staleSessionIds[sessionId]
        return {
          messages,
          streamingMessage: shouldClearStreaming
            ? null
            : shouldRestoreRunning
              ? streamingFromRunningMessage(running)
              : state.streamingMessage,
          runningSessionIds: hasRunning
            ? { ...state.runningSessionIds, [sessionId]: true }
            : shouldConfirmDoneState
              ? removeSessionIndicator(state.runningSessionIds, sessionId)
              : state.runningSessionIds,
          unreadSessionIds: hasRunning ? removeSessionIndicator(state.unreadSessionIds, sessionId) : state.unreadSessionIds,
          staleSessionIds: removeSessionIndicator(state.staleSessionIds, sessionId),
          hasMoreMessagesBySession: {
            ...state.hasMoreMessagesBySession,
            [sessionId]: serverMessages.length >= CHAT_MESSAGE_PAGE_SIZE,
          },
        }
      })
      saveCache(sessionId, get())
      const running = get().messages
        .filter((message) => message.session_id === sessionId && message.role === 'agent' && message.status === 'running')
        .at(-1)
      if (running) {
        set((state) => ({
          runningSessionIds: { ...state.runningSessionIds, [sessionId]: true },
          unreadSessionIds: removeSessionIndicator(state.unreadSessionIds, sessionId),
          staleSessionIds: removeSessionIndicator(state.staleSessionIds, sessionId),
        }))
        void get().fetchMessageProcess(sessionId, running.id)
      }
      if (get().messages.filter((message) => message.session_id === sessionId).length === 0) {
        void get().fetchEvents(sessionId)
      }
    } catch { /* ignore message load errors */ }
  },

  loadOlderMessages: async (sessionId) => {
    const state = get()
    if (state.loadingOlderMessagesBySession[sessionId] || state.hasMoreMessagesBySession[sessionId] === false) return
    const sessionMessages = state.messages
      .filter((message) => message.session_id === sessionId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    const oldest = sessionMessages[0]
    if (!oldest) return
    set((current) => ({
      loadingOlderMessagesBySession: { ...current.loadingOlderMessagesBySession, [sessionId]: true },
    }))
    try {
      const olderMessages = await wsClient.request({
        type: 'sessions.messages',
        sessionId,
        limit: CHAT_MESSAGE_PAGE_SIZE,
        before: oldest.timestamp,
      }) as MessageData[]
      if (sessionId !== get().currentSessionId) return
      set((current) => ({
        messages: mergeMessagesForSession(olderMessages, current.messages, sessionId),
        hasMoreMessagesBySession: {
          ...current.hasMoreMessagesBySession,
          [sessionId]: olderMessages.length >= CHAT_MESSAGE_PAGE_SIZE,
        },
      }))
      saveCache(sessionId, get())
    } catch {
      // ignore older history load errors
    } finally {
      set((current) => ({
        loadingOlderMessagesBySession: withoutKey(current.loadingOlderMessagesBySession, sessionId),
      }))
    }
  },

  fetchEvents: async (sessionId) => {
    try {
      const events = await wsClient.request({ type: 'sessions.events', sessionId, limit: 1000 }) as SessionEventData[]
      if (sessionId !== get().currentSessionId) return
      eventCursorBySession.set(sessionId, events.at(-1)?.sequence ?? 0)
      const stateBeforeRecovery = get()
      const shouldUseMessagePrimaryHistory = stateBeforeRecovery.messages.length > 0
      const recoveryEvents = shouldUseMessagePrimaryHistory
        ? events.filter((event) => !mirroredRealtimeEventTypes.has(event.type))
        : events
      const reduced = reduceSessionEvents(recoveryEvents)
      const activeTurnRecovery = shouldUseMessagePrimaryHistory ? reduceSessionEvents(events).streamingMessage : reduced.streamingMessage
      set((state) => ({
        events,
        usage: reduced.usage,
        turnUsage: reduced.turnUsage,
        capabilities: mergeCapabilities(state.capabilities, reduced.capabilities),
        plan: reduced.plan,
        pendingPermissions: reduced.pendingPermissions,
        pendingElicitations: reduced.pendingElicitations,
        streamingMessage: shouldUseMessagePrimaryHistory
          ? selectRecoveredStreamingMessage(
              state.streamingMessage,
              activeTurnRecovery,
              state.messages,
              !!state.runningSessionIds[sessionId] && !state.staleSessionIds[sessionId],
            )
          : state.runningSessionIds[sessionId] && !state.staleSessionIds[sessionId]
            ? reduced.streamingMessage
            : null,
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

  copySession: async (sessionId) => {
    const session = await wsClient.request({ type: 'sessions.copy', sessionId }) as SessionData
    if (!activeSessionsProjectId || session.project_id === activeSessionsProjectId) {
      set((state) => ({
        sessions: [...state.sessions.filter((s) => s.id !== session.id), session],
        copyingTargetSessionIds: isCopyingSession(session)
          ? { ...state.copyingTargetSessionIds, [session.id]: sessionId }
          : state.copyingTargetSessionIds,
        copyingSourceSessionIds: isCopyingSession(session)
          ? { ...state.copyingSourceSessionIds, [sessionId]: session.id }
          : state.copyingSourceSessionIds,
        lastCopyError: null,
      }))
    }
    return session
  },

  listLocalImportCandidates: async (agentId, projectId) => {
    const msg: Record<string, unknown> = { type: 'sessions.listLocalImportCandidates', agentId }
    if (projectId) msg.projectId = projectId
    return await wsClient.request(msg) as LocalSessionCandidateInfo[]
  },

  importLocalSession: async (agentId, input) => {
    const session = await wsClient.request({ type: 'sessions.importLocal', agentId, ...input }) as LocalSessionImportResult
    if (!activeSessionsProjectId || session.session.project_id === activeSessionsProjectId) {
      set((state) => ({ sessions: [...state.sessions.filter((s) => s.id !== session.session.id), session.session] }))
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
    writeStoredSessionId(currentSessionId)
    set({
      sessions: get().sessions.filter(s => s.id !== sessionId),
      currentSessionId,
      messages: currentSessionId ? get().messages : [],
      events: currentSessionId ? get().events : [],
      streamingMessage: currentSessionId ? get().streamingMessage : null,
      toolCallSummariesByMessageId: currentSessionId ? get().toolCallSummariesByMessageId : {},
      toolCallDetailsByKey: currentSessionId ? get().toolCallDetailsByKey : {},
      fileChangeDetailsByMessageId: currentSessionId ? get().fileChangeDetailsByMessageId : {},
      toolCallLoadingByKey: currentSessionId ? get().toolCallLoadingByKey : {},
      toolCallErrorByKey: currentSessionId ? get().toolCallErrorByKey : {},
      turnProcessLoadingByMessageId: currentSessionId ? get().turnProcessLoadingByMessageId : {},
      turnProcessErrorByMessageId: currentSessionId ? get().turnProcessErrorByMessageId : {},
      processItemLoadingByKey: currentSessionId ? get().processItemLoadingByKey : {},
      processItemErrorByKey: currentSessionId ? get().processItemErrorByKey : {},
      runningSessionIds: removeSessionIndicator(get().runningSessionIds, sessionId),
      unreadSessionIds: removeSessionIndicator(get().unreadSessionIds, sessionId),
      staleSessionIds: removeSessionIndicator(get().staleSessionIds, sessionId),
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

  reorderSessions: async (projectId, agentId, sessionIds) => {
    const ordered = await wsClient.request({ type: 'sessions.reorder', projectId, agentId, sessionIds }) as SessionData[]
    const orderedIds = new Set(ordered.map((session) => session.id))
    set((state) => ({
      sessions: [
        ...state.sessions.filter((session) => session.agent_id !== agentId || session.project_id !== projectId || !orderedIds.has(session.id)),
        ...ordered,
      ],
    }))
    return ordered
  },

  clearCopyError: () => set({ lastCopyError: null }),

  selectSession: (id) => {
    const prev = get().currentSessionId
    if (prev) { saveCache(prev, get()); wsClient.unsubscribe([prev]) }
    lastStreamingSnapshot = null
    if (!id) {
      writeStoredSessionId(null)
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
        fileChangeDetailsByMessageId: {},
        toolCallLoadingByKey: {},
        toolCallErrorByKey: {},
        turnProcessLoadingByMessageId: {},
        turnProcessErrorByMessageId: {},
        processItemLoadingByKey: {},
        processItemErrorByKey: {},
      })
      return
    }
    writeStoredSessionId(id)
    wsClient.subscribe([id])
    const c = sessionCaches.get(id)
    const shouldRestoreStreaming = !!get().runningSessionIds[id] && !get().staleSessionIds[id]
    streamingBuffer.clear()
    if (streamingFlushTimer) { clearTimeout(streamingFlushTimer); streamingFlushTimer = null }
    set({
      currentSessionId: id, messages: c?.messages || [], events: c?.events || [], streamingMessage: shouldRestoreStreaming ? c?.streamingMessage || null : null,
      usage: c?.usage || null, turnUsage: c?.turnUsage || null, capabilities: c?.capabilities || { ...defaultCaps }, plan: c?.plan || [],
      pendingPermissions: c?.pendingPermissions || [], pendingElicitations: c?.pendingElicitations || [],
      toolCallSummariesByMessageId: {}, toolCallDetailsByKey: {}, fileChangeDetailsByMessageId: {}, toolCallLoadingByKey: {}, toolCallErrorByKey: {},
      turnProcessLoadingByMessageId: {}, turnProcessErrorByMessageId: {}, processItemLoadingByKey: {}, processItemErrorByKey: {},
      unreadSessionIds: removeSessionIndicator(get().unreadSessionIds, id),
    })
    void get().fetchMessages(id)
    void get().fetchModels()
    void markSessionReadOnServer(id)
  },

  sendPrompt: (content, images) => {
    const sid = get().currentSessionId; if (!sid) return
    const session = get().sessions.find((item) => item.id === sid)
    if (isCopyingSession(session) || get().copyingTargetSessionIds[sid]) return
    const clientMessageId = `msg-local-${Date.now()}`
    const msg: Record<string, unknown> = { type: 'prompt', sessionId: sid, content, clientMessageId }
    if (images?.length) msg.images = images
    wsClient.send(msg)
    promptStartTime = Date.now()
    set((state) => ({
      messages: [...state.messages, normalizeMessage({ id: clientMessageId, session_id: sid, role: 'human', content, thinking: null, tool_calls_json: null, decision_json: null, attachments_json: images?.length ? JSON.stringify(images) : null, file_changes_json: null, timestamp: new Date().toISOString() })],
      streamingMessage: applyTurnEntry(createEmptyTurn(`pending-${sid}-${Date.now()}`), { kind: 'stage', text: '\u6b63\u5728\u51c6\u5907 Agent...' }),
      turnUsage: null,
      runningSessionIds: { ...state.runningSessionIds, [sid]: true },
      unreadSessionIds: removeSessionIndicator(state.unreadSessionIds, sid),
      staleSessionIds: removeSessionIndicator(state.staleSessionIds, sid),
    }))
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

  fetchMessageFileChanges: async (sessionId, messageId) => {
    const key = `file:${messageId}`
    if (get().fileChangeDetailsByMessageId[messageId]) return
    if (get().toolCallLoadingByKey[key]) return
    set((state) => ({
      toolCallLoadingByKey: { ...state.toolCallLoadingByKey, [key]: true },
      toolCallErrorByKey: { ...state.toolCallErrorByKey, [key]: '' },
    }))
    try {
      const detail = await wsClient.request({ type: 'sessions.messageFileChanges', sessionId, messageId }) as FileChangeDetailInfo
      if (sessionId !== get().currentSessionId) return
      set((state) => ({
        fileChangeDetailsByMessageId: { ...state.fileChangeDetailsByMessageId, [messageId]: detail },
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

  fetchMessageProcess: async (sessionId, messageId) => {
    const existing = get().messages.find((message) => message.id === messageId && message.session_id === sessionId)
    if (!shouldLoadMessageProcess(existing)) return
    set((state) => ({
      turnProcessLoadingByMessageId: { ...state.turnProcessLoadingByMessageId, [messageId]: true },
      turnProcessErrorByMessageId: { ...state.turnProcessErrorByMessageId, [messageId]: '' },
    }))
    try {
      const items = await wsClient.request({ type: 'sessions.messageProcess', sessionId, messageId }) as TurnProcessItemInfo[]
      if (sessionId !== get().currentSessionId) return
      let turn = turnFromProcessItems(messageId, items)
      if (items.length === 0 && existing?.has_tool_calls) {
        const events = await wsClient.request({ type: 'sessions.messageEvents', sessionId, messageId }) as SessionEventData[]
        if (sessionId !== get().currentSessionId) return
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
          ? {
              ...turn,
              finalAnswer: existing.content,
              content: existing.content,
              done: false,
            }
          : state.streamingMessage,
        turnProcessLoadingByMessageId: { ...state.turnProcessLoadingByMessageId, [messageId]: false },
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((state) => ({
        turnProcessLoadingByMessageId: { ...state.turnProcessLoadingByMessageId, [messageId]: false },
        turnProcessErrorByMessageId: { ...state.turnProcessErrorByMessageId, [messageId]: message },
      }))
    }
  },


  fetchProcessItemDetail: async (sessionId, messageId, itemId) => {
    const key = processItemCacheKey(messageId, itemId)
    const message = get().messages.find((item) => item.id === messageId && item.session_id === sessionId)
    const block = message?.processBlocks?.find((item) => item.id === itemId)
    if (block && !('hasDetail' in block && block.hasDetail)) return
    if (get().processItemLoadingByKey[key]) return
    set((state) => ({
      processItemLoadingByKey: { ...state.processItemLoadingByKey, [key]: true },
      processItemErrorByKey: { ...state.processItemErrorByKey, [key]: '' },
    }))
    try {
      const item = await wsClient.request({ type: 'sessions.processItemDetail', sessionId, messageId, itemId }) as TurnProcessItemInfo
      if (sessionId !== get().currentSessionId) {
        set((state) => ({ processItemLoadingByKey: withoutRecordKey(state.processItemLoadingByKey, key) }))
        return
      }
      const detailBlock = turnFromProcessItems(messageId, [item]).processBlocks[0]
      if (!detailBlock) {
        set((state) => ({ processItemLoadingByKey: withoutRecordKey(state.processItemLoadingByKey, key) }))
        return
      }
      set((state) => {
        const streaming = state.streamingMessage?.id === messageId
          ? mergeProcessBlockIntoStreaming(state.streamingMessage, detailBlock)
          : state.streamingMessage
        return {
          messages: state.messages.map((current) => current.id === messageId && current.session_id === sessionId
            ? { ...current, processBlocks: mergeProcessBlock(current.processBlocks || [], detailBlock) }
            : current),
          streamingMessage: streaming,
          processItemLoadingByKey: withoutRecordKey(state.processItemLoadingByKey, key),
          processItemErrorByKey: withoutRecordKey(state.processItemErrorByKey, key),
        }
      })
      saveCache(sessionId, get())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((state) => ({
        processItemLoadingByKey: withoutRecordKey(state.processItemLoadingByKey, key),
        processItemErrorByKey: { ...state.processItemErrorByKey, [key]: message },
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
      if (event.type.startsWith('lifecycle.') && !shouldShowLifecycleStage(event.type)) {
        saveCache(sid, get())
        return
      }
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

    offs.push(wsClient.on('session:process_item', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const item = msg.item as TurnProcessItemInfo
      const block = turnFromProcessItems(item.message_id, [item]).processBlocks[0]
      if (!block) return
      set((state) => {
        const streamingBase = streamingBaseForProcessItem(state.streamingMessage, item, !!state.runningSessionIds[sid])
        const streaming = streamingBase?.id === item.message_id
          ? mergeProcessBlockIntoStreaming(streamingBase, block)
          : state.streamingMessage
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
      saveCache(sid, get())
    }))

    offs.push(wsClient.on('session:update', (msg) => {
      const sid = msg.sessionId as string; if (sid !== get().currentSessionId) return
      const data = msg.data as Record<string, unknown>

      if (typeof data.eventType === 'string' && data.eventType.startsWith('lifecycle.')) {
        if (!shouldShowLifecycleStage(data.eventType)) {
          saveCache(sid, get())
          return
        }
        const stage = String(data.content || '')
        set((state) => {
          const cur = state.streamingMessage
          const base: StreamingMessage = cur || createEmptyTurn(String(data.messageId || `stream-${sid}-${Date.now()}`))
          return { streamingMessage: applyTurnEntry(base, { kind: 'stage', text: stage }) }
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
        const messageId = typeof data.messageId === 'string' ? data.messageId : undefined
        if (!data.contentDelta && hasCanonicalProcessBlock(get().streamingMessage, messageId, data)) return
        streamingBuffer.push({
          messageId,
          contentDelta: typeof data.contentDelta === 'string' ? data.contentDelta : undefined,
          thinking: typeof data.thinking === 'string' ? data.thinking : undefined,
          toolCall: data.toolCall as ToolCallInfo | undefined,
          toolCallUpdate: data.toolCallUpdate as ToolCallInfo | undefined,
        })
        scheduleStreamingFlush(set, get)
      }
    }))

    offs.push(wsClient.on('session:done', (msg) => {
      const sid = msg.sessionId as string
      if (sid !== get().currentSessionId) {
        clearCachedStreaming(sid)
        set((st) => ({
          runningSessionIds: removeSessionIndicator(st.runningSessionIds, sid),
          unreadSessionIds: { ...st.unreadSessionIds, [sid]: true },
          staleSessionIds: { ...st.staleSessionIds, [sid]: true },
        }))
        return
      }
      flushStreamingBuffer(set, get)
      set((st) => ({ staleSessionIds: { ...st.staleSessionIds, [sid]: true } }))
      const tu = msg.turnUsage as TurnUsageInfo | undefined
      const cost = get().usage?.costAmount
      const elapsed = promptStartTime > 0 ? Math.round((Date.now() - promptStartTime) / 1000) : undefined
      promptStartTime = 0

      const s = get().streamingMessage || lastStreamingSnapshot
      lastStreamingSnapshot = null

      const turnStats = tu ? JSON.stringify({ ...tu, costAmount: cost, elapsedSeconds: elapsed }) : null

      if (turnHasFinalizableContent(s)) {
        const finalizedToolCalls = s.toolCalls.map(tc =>
          (tc.status === 'pending' || tc.status === 'in_progress') ? { ...tc, status: 'completed' } : tc
        )
        const finalizedProcessBlocks = processBlocksForCompletedTurn(s).map(block =>
          block.kind === 'tool'
            ? {
                ...block,
                toolCall: (block.toolCall.status === 'pending' || block.toolCall.status === 'in_progress')
                  ? { ...block.toolCall, status: 'completed' }
                  : block.toolCall,
              }
            : block,
        )
        const newMsg: MessageData = {
          id: s.id, session_id: sid, role: 'agent', content: s.finalAnswer,
          thinking: s.thinking || null,
          tool_calls_json: finalizedToolCalls.length > 0 ? JSON.stringify(finalizedToolCalls) : null,
          decision_json: turnStats, attachments_json: null,
          file_changes_json: null,
          timestamp: new Date().toISOString(),
          processBlocks: finalizedProcessBlocks,
          finalAnswer: s.finalAnswer,
          processDefaultOpen: undefined,
        }
        set(st => ({
          messages: appendFinalizedMessage(st.messages, newMsg),
          streamingMessage: null, turnUsage: tu || st.turnUsage, plan: clearPlanOnTurnDone(),
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
            streamingMessage: null, turnUsage: tu || st.turnUsage, plan: clearPlanOnTurnDone(),
          }))
        } else {
          set(st => ({
            streamingMessage: null,
            turnUsage: tu || st.turnUsage,
            plan: clearPlanOnTurnDone(),
          }))
        }
      }
      saveCache(sid, get())
      void get().fetchMessages(sid)
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
          turnProcessLoadingByMessageId: st.currentSessionId === sessionId ? {} : st.turnProcessLoadingByMessageId,
          turnProcessErrorByMessageId: st.currentSessionId === sessionId ? {} : st.turnProcessErrorByMessageId,
          processItemLoadingByKey: st.currentSessionId === sessionId ? {} : st.processItemLoadingByKey,
          processItemErrorByKey: st.currentSessionId === sessionId ? {} : st.processItemErrorByKey,
          runningSessionIds: removeSessionIndicator(st.runningSessionIds, sessionId),
          unreadSessionIds: removeSessionIndicator(st.unreadSessionIds, sessionId),
          staleSessionIds: removeSessionIndicator(st.staleSessionIds, sessionId),
        }))
        return
      }
      set(st => {
        const incomingProjectId = data.project_id as string | null | undefined
        const inCurrentScope = !activeSessionsProjectId || incomingProjectId === undefined || incomingProjectId === activeSessionsProjectId
        if (!inCurrentScope) return { sessions: st.sessions.filter(s => s.id !== sessionId) }
        const sourceSessionId = st.copyingTargetSessionIds[sessionId]
        const copyDone = !!sourceSessionId && !isCopyingSession(data)
        const copyState = copyDone
          ? {
              copyingTargetSessionIds: withoutKey(st.copyingTargetSessionIds, sessionId),
              copyingSourceSessionIds: withoutKey(st.copyingSourceSessionIds, sourceSessionId),
            }
          : {}
        if (st.sessions.some(s => s.id === sessionId)) {
          const mergedSession = { ...st.sessions.find(s => s.id === sessionId)!, ...data } as SessionData
          const isCurrent = st.currentSessionId === sessionId
          const nextUnread = data.last_read_at
            ? (isCurrent ? false : isSessionUnreadByTimestamps(mergedSession))
            : st.unreadSessionIds[sessionId] ? true : false
          const unreadSessionIds = nextUnread
            ? { ...st.unreadSessionIds, [sessionId]: true as const }
            : removeSessionIndicator(st.unreadSessionIds, sessionId)
          return {
            sessions: st.sessions.map(s => s.id === sessionId ? mergedSession : s),
            unreadSessionIds,
            ...copyState,
          }
        }
        if (isCompleteSessionData(data, sessionId) && (!activeSessionsProjectId || data.project_id === activeSessionsProjectId)) {
          return { sessions: [...st.sessions, data], ...copyState }
        }
        return { sessions: st.sessions }
      })
    }))

    offs.push(wsClient.on('session:copy_failed', (msg) => {
      const sourceSessionId = String(msg.sourceSessionId || '')
      const targetSessionId = String(msg.targetSessionId || '')
      const message = String(msg.message || '复制会话失败')
      if (!sourceSessionId || !targetSessionId) return
      const shouldSelectSource = get().currentSessionId === targetSessionId
      sessionCaches.delete(targetSessionId)
      set(st => ({
        sessions: st.sessions.filter((session) => session.id !== targetSessionId),
        messages: st.currentSessionId === targetSessionId ? [] : st.messages,
        events: st.currentSessionId === targetSessionId ? [] : st.events,
        streamingMessage: st.currentSessionId === targetSessionId ? null : st.streamingMessage,
        copyingTargetSessionIds: withoutKey(st.copyingTargetSessionIds, targetSessionId),
        copyingSourceSessionIds: withoutKey(st.copyingSourceSessionIds, sourceSessionId),
        lastCopyError: { sourceSessionId, targetSessionId, message },
      }))
      if (shouldSelectSource) get().selectSession(sourceSessionId)
    }))

    offs.push(wsClient.on('session:activity', (msg) => {
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : ''
      if (!sessionId) return
      const state = msg.state === 'running' ? 'running' : 'idle'
      if (state === 'idle') clearCachedStreaming(sessionId)
      const isCurrent = sessionId === get().currentSessionId
      if (state === 'idle' && isCurrent) flushStreamingBuffer(set, get)
      set((st) => ({
        ...applySessionActivity(st.runningSessionIds, st.unreadSessionIds, st.staleSessionIds, sessionId, state, st.currentSessionId),
        streamingMessage: state === 'idle' && st.currentSessionId === sessionId ? null : st.streamingMessage,
      }))
      if (state === 'idle' && isCurrent) {
        void get().fetchMessages(sessionId)
      }
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
