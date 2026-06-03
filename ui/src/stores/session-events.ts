import {
  applyTurnEntry,
  createEmptyTurn,
  flattenProcessText,
  turnHasFinalizableContent,
  type TurnProcessBlock,
  type TurnViewModel,
} from './turn-blocks'

export interface ImageAttachmentInfo {
  data: string
  mimeType: string
  name?: string
}

export interface MessageData {
  id: string; session_id: string; role: string; content: string
  thinking: string | null; tool_calls_json: string | null; decision_json: string | null; attachments_json?: string | null; timestamp: string
  has_tool_calls?: boolean; tool_call_count?: number
  parsedToolCalls?: ToolCallInfo[]; parsedAttachments?: ImageAttachmentInfo[]; parsedDecision?: Record<string, unknown> | null
  processBlocks?: TurnProcessBlock[]; finalAnswer?: string
  processDefaultOpen?: boolean
}

export interface ToolCallInfo {
  id: string; title: string; kind?: string; status?: string
  locations?: { path: string; line?: number }[]
  rawInput?: unknown; rawOutput?: unknown
  content?: { type: string; text?: string; path?: string; oldText?: string; newText?: string; terminalId?: string }[]
  terminalOutput?: string
  terminalOutputDelta?: string
  progress?: string[]
  progressDelta?: string
  error?: string
}


export interface ToolCallSummaryInfo {
  id: string
  title: string
  kind?: string
  status?: string
  hasRawInput: boolean
  hasRawOutput: boolean
  hasTerminalOutput: boolean
  outputPreview?: string
  error?: string
}

export interface ToolCallDetailInfo {
  id: string
  title: string
  kind?: string
  status?: string
  locations?: { path: string; line?: number }[]
  rawInputPreview?: string
  rawInputTruncated?: boolean
  rawOutputPreview?: string
  rawOutputTruncated?: boolean
  terminalOutputTail?: string
  terminalOutputTruncated?: boolean
  contentPreview?: { type: string; text?: string; path?: string; oldText?: string; newText?: string; terminalId?: string }[]
  contentTruncated?: boolean
  progressTail?: string[]
  progressTruncated?: boolean
  error?: string
}
export interface UsageInfo { contextSize: number; contextUsed: number; costAmount?: number; costCurrency?: string }
export interface TurnUsageInfo { inputTokens: number; outputTokens: number; totalTokens: number; cachedReadTokens?: number; thoughtTokens?: number }
export interface ModelInfo { modelId: string; name: string; description?: string }
export interface ModeInfo { modeId: string; name: string; description?: string }
export interface PlanEntry { content: string; status: string; priority: string }
export interface ConfigOptionInfo { id: string; name: string; description?: string; category?: string; type: string; currentValue?: string | boolean; options?: { value: string; name: string; description?: string; group?: string }[] }
export interface AvailableCommandInfo { name: string; description: string; input?: { hint: string } | null }
export interface SessionInfoData { title?: string; updatedAt?: string }
export interface PermissionRequestInfo { id: string; toolCall: ToolCallInfo; options: { optionId: string; name: string; kind: string }[]; resolved?: boolean }
export interface ElicitationRequestInfo { id: string; toolCallId?: string; message?: string; requestedSchema?: unknown; resolved?: boolean }

export interface SessionCapabilities {
  models: ModelInfo[]; currentModelId: string | null
  modes: ModeInfo[]; currentModeId: string | null
  supportsImages: boolean
  supportsAudio?: boolean
  configOptions: ConfigOptionInfo[]
  commands: AvailableCommandInfo[]
  sessionInfo?: SessionInfoData
}

export type StreamingMessage = TurnViewModel

export interface ChatTimelineMessageItem {
  id: string
  kind: 'message'
  role: 'human' | 'agent' | 'system'
  content: string
  thinking?: string | null
  attachments?: ImageAttachmentInfo[]
  timestamp: string
  messageId?: string | null
  turnStats?: TurnUsageInfo
}

export interface ChatTimelineToolItem {
  id: string
  kind: 'tool'
  role: 'agent'
  toolCall: ToolCallInfo
  timestamp: string
  messageId?: string | null
}

export type ChatTimelineItem = ChatTimelineMessageItem | ChatTimelineToolItem

export interface ChatTimelineGroup {
  id: string
  role: 'human' | 'agent' | 'system'
  timestamp: string
  messageId?: string | null
  blocks: ChatTimelineItem[]
}

export interface SessionEventData {
  id: string
  session_id: string
  agent_id?: string | null
  acp_session_id?: string | null
  message_id?: string | null
  type: string
  role?: string | null
  payload_json: string
  sequence: number
  created_at: string
}

export interface ReducedSessionEvents {
  streamingMessage: StreamingMessage | null
  usage: UsageInfo | null
  turnUsage: TurnUsageInfo | null
  capabilities: SessionCapabilities
  plan: PlanEntry[]
  pendingPermissions: PermissionRequestInfo[]
  pendingElicitations: ElicitationRequestInfo[]
}

export const defaultCaps: SessionCapabilities = {
  models: [], currentModelId: null,
  modes: [], currentModeId: null,
  supportsImages: false,
  supportsAudio: false,
  configOptions: [], commands: [],
}



export function parseJsonArray<T>(raw?: string | null): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export function parseJsonObject<T>(raw?: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function normalizeMessage(message: MessageData): MessageData {
  const parsedToolCalls = message.tool_calls_json ? parseJsonArray<ToolCallInfo>(message.tool_calls_json) : message.parsedToolCalls
  const parsedAttachments = message.attachments_json ? parseJsonArray<ImageAttachmentInfo>(message.attachments_json) : message.parsedAttachments
  const parsedDecision = message.decision_json ? parseJsonObject<Record<string, unknown>>(message.decision_json) : message.parsedDecision
  const hasToolCalls = message.has_tool_calls ?? (!!message.tool_calls_json || !!parsedToolCalls?.length)
  const toolCallCount = message.tool_call_count ?? parsedToolCalls?.length
  return {
    ...message,
    has_tool_calls: hasToolCalls,
    tool_call_count: toolCallCount,
    parsedToolCalls,
    parsedAttachments,
    parsedDecision,
  }
}

export function normalizeMessages(messages: MessageData[]): MessageData[] {
  return messages.map(normalizeMessage)
}
export function mergeMessagesById(serverMessages: MessageData[], currentMessages: MessageData[]): MessageData[] {
  const byId = new Map<string, MessageData>()
  for (const msg of currentMessages) byId.set(msg.id, normalizeMessage(msg))
  for (const msg of serverMessages) {
    const normalized = normalizeMessage(msg)
    const existing = byId.get(msg.id)
    byId.set(msg.id, keepExistingFullToolCalls(normalized, existing))
  }
  return Array.from(byId.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

export function mergeMessagesForSession(serverMessages: MessageData[], currentMessages: MessageData[], sessionId: string): MessageData[] {
  return mergeMessagesById(
    serverMessages,
    currentMessages.filter((message) => message.session_id === sessionId),
  )
}

function keepExistingFullToolCalls(next: MessageData, existing?: MessageData): MessageData {
  const withStats = !next.decision_json && existing?.decision_json
    ? normalizeMessage({
        ...next,
        decision_json: existing.decision_json,
        parsedDecision: existing.parsedDecision,
      })
    : next
  const withProcess = existing?.processBlocks || existing?.finalAnswer
    ? {
        ...withStats,
        processBlocks: existing.processBlocks,
        finalAnswer: existing.finalAnswer ?? withStats.content,
        processDefaultOpen: withStats.processDefaultOpen,
      }
    : withStats
  if (!existing?.tool_calls_json || withProcess.tool_calls_json) return withProcess
  if (!withProcess.has_tool_calls) return withProcess
  return normalizeMessage({
    ...withProcess,
    tool_calls_json: existing.tool_calls_json,
    parsedToolCalls: existing.parsedToolCalls,
    tool_call_count: withProcess.tool_call_count ?? existing.tool_call_count,
  })
}

export function appendFinalizedMessage(currentMessages: MessageData[], message: MessageData): MessageData[] {
  const normalized = normalizeMessage(message)
  if (!currentMessages.some(m => m.id === message.id)) return [...currentMessages, normalized]

  const suffixBase = Date.parse(message.timestamp) || Date.now()
  let nextId = `${message.id}-${suffixBase}`
  let i = 1
  while (currentMessages.some(m => m.id === nextId)) {
    i += 1
    nextId = `${message.id}-${suffixBase}-${i}`
  }
  return [...currentMessages, { ...normalized, id: nextId }]
}

export function buildErrorAgentMessage(sessionId: string, messageId: string, error: string): MessageData {
  return normalizeMessage({
    id: messageId,
    session_id: sessionId,
    role: 'agent',
    content: `执行失败：${error}`,
    thinking: null,
    tool_calls_json: null,
    decision_json: null,
    attachments_json: null,
    timestamp: new Date().toISOString(),
  })
}

const GENERIC_TOOL_TITLES = new Set(['工具调用', 'Tool call', 'tool call'])

function hasMeaningfulTitle(tool: ToolCallInfo): boolean {
  return !!tool.title && !GENERIC_TOOL_TITLES.has(tool.title) && !tool.title.startsWith('工具调用 #')
}

export function shouldCreateToolFromUpdate(update: ToolCallInfo): boolean {
  return !!(
    hasMeaningfulTitle(update) ||
    update.kind ||
    update.locations?.length ||
    update.rawInput !== undefined ||
    update.rawOutput !== undefined ||
    update.content?.length ||
    update.terminalOutput ||
    update.terminalOutputDelta ||
    update.progress?.length ||
    update.progressDelta ||
    update.error
  )
}

export function upsertToolCall(tools: ToolCallInfo[], update: ToolCallInfo, createIfMissing = true): ToolCallInfo[] {
  const idx = tools.findIndex(t => t.id === update.id)
  if (idx >= 0) {
    const next = [...tools]
    next[idx] = mergeToolCall(next[idx], update)
    return next
  }
  if (!createIfMissing || !shouldCreateToolFromUpdate(update)) return tools
  return [...tools, update]
}

export function mergeToolCall(existing: ToolCallInfo, update: ToolCallInfo): ToolCallInfo {
  const next: ToolCallInfo = { ...existing }
  if (hasMeaningfulTitle(update) || !hasMeaningfulTitle(next)) next.title = update.title
  if (update.kind) next.kind = update.kind
  if (update.status) next.status = update.status
  if (update.locations) next.locations = update.locations
  if (update.rawInput !== undefined) next.rawInput = update.rawInput
  if (update.rawOutput !== undefined) next.rawOutput = update.rawOutput
  if (update.content) next.content = update.content
  if (update.terminalOutput !== undefined) next.terminalOutput = update.terminalOutput
  if (update.terminalOutputDelta) next.terminalOutput = `${next.terminalOutput || ''}${update.terminalOutputDelta}`
  if (update.progress) next.progress = update.progress
  if (update.progressDelta) next.progress = [...(next.progress || []), update.progressDelta]
  if (update.error !== undefined) next.error = update.error
  return next
}

export function capabilitiesFromConfig(current: SessionCapabilities, configOptions: ConfigOptionInfo[]): SessionCapabilities {
  const optionMap = new Map(current.configOptions.map(option => [option.id, option]))
  for (const option of configOptions) optionMap.set(option.id, option)
  const mergedConfigOptions = Array.from(optionMap.values())
  const next: SessionCapabilities = { ...current, configOptions: mergedConfigOptions }
  const modelOpt = mergedConfigOptions.find(o => o.category === 'model' || o.id === 'model')
  if (modelOpt?.type === 'select') {
    if (typeof modelOpt.currentValue === 'string') next.currentModelId = modelOpt.currentValue
    if (modelOpt.options) next.models = modelOpt.options.map(o => ({ modelId: o.value, name: o.name, description: o.description }))
  }
  const modeOpt = mergedConfigOptions.find(o => o.category === 'mode' || o.id === 'mode')
  if (modeOpt?.type === 'select') {
    if (typeof modeOpt.currentValue === 'string') next.currentModeId = modeOpt.currentValue
    if (modeOpt.options) next.modes = modeOpt.options.map(o => ({ modeId: o.value, name: o.name, description: o.description }))
  }
  return next
}

export function mergeCapabilities(current: SessionCapabilities, incoming: SessionCapabilities): SessionCapabilities {
  const configOptions = incoming.configOptions.length > 0
    ? capabilitiesFromConfig(current, incoming.configOptions).configOptions
    : current.configOptions
  return {
    ...current,
    models: incoming.models.length > 0 ? incoming.models : current.models,
    currentModelId: incoming.currentModelId || current.currentModelId,
    modes: incoming.modes.length > 0 ? incoming.modes : current.modes,
    currentModeId: incoming.currentModeId || current.currentModeId,
    supportsImages: incoming.supportsImages || current.supportsImages,
    supportsAudio: incoming.supportsAudio || current.supportsAudio,
    configOptions,
    commands: incoming.commands.length > 0 ? incoming.commands : current.commands,
    sessionInfo: incoming.sessionInfo || current.sessionInfo,
  }
}

export function finalizePlanOnTurnDone(plan: PlanEntry[], stopReason?: string): PlanEntry[] {
  if (stopReason && stopReason !== 'end_turn') return plan
  return plan.map((entry) => entry.status === 'in_progress' ? { ...entry, status: 'completed' } : entry)
}

function parsePayload(event: SessionEventData): Record<string, unknown> {
  try { return JSON.parse(event.payload_json) as Record<string, unknown> } catch { return {} }
}

interface PendingTimelineMessage {
  role: 'agent' | 'system'
  messageId: string | null
  content: string
  thinking: string
  startSequence: number
  timestamp: string
}

function emptyPendingTimelineMessage(event: SessionEventData, role: 'agent' | 'system', messageId: string | null): PendingTimelineMessage {
  return {
    role,
    messageId,
    content: '',
    thinking: '',
    startSequence: event.sequence,
    timestamp: event.created_at,
  }
}

function hasPendingTimelineContent(pending: PendingTimelineMessage | null): pending is PendingTimelineMessage {
  return !!pending && (!!pending.content || !!pending.thinking)
}

function flushPendingTimelineMessage(items: ChatTimelineItem[], pending: PendingTimelineMessage | null): PendingTimelineMessage | null {
  if (!hasPendingTimelineContent(pending)) return null
  items.push({
    id: `timeline-msg-${pending.messageId || 'unknown'}-${pending.startSequence}`,
    kind: 'message',
    role: pending.role,
    content: pending.content,
    thinking: pending.thinking || null,
    timestamp: pending.timestamp,
    messageId: pending.messageId,
  })
  return null
}

function payloadMessageId(event: SessionEventData, payload: Record<string, unknown>): string | null {
  const messageId = payload.messageId ?? event.message_id
  return messageId == null ? null : String(messageId)
}

export function buildChatTimelineFromEvents(events: SessionEventData[]): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = []
  const toolIndexById = new Map<string, number>()
  let pending: PendingTimelineMessage | null = null

  const ensurePending = (event: SessionEventData, role: 'agent' | 'system', messageId: string | null) => {
    if (!pending || pending.role !== role || pending.messageId !== messageId) {
      pending = flushPendingTimelineMessage(items, pending)
      pending = emptyPendingTimelineMessage(event, role, messageId)
    }
    return pending
  }

  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const payload = parsePayload(event)
    const messageId = payloadMessageId(event, payload)

    switch (event.type) {
      case 'message.user': {
        pending = flushPendingTimelineMessage(items, pending)
        items.push({
          id: `timeline-user-${messageId || event.id}`,
          kind: 'message',
          role: 'human',
          content: String(payload.content || ''),
          attachments: (payload.attachments as ImageAttachmentInfo[]) || [],
          timestamp: event.created_at,
          messageId,
        })
        break
      }
      case 'message.chunk': {
        if (payload.role !== 'agent') break
        const msg = ensurePending(event, 'agent', messageId)
        msg.content += String(payload.contentDelta || payload.content || '')
        break
      }
      case 'thinking.chunk': {
        const msg = ensurePending(event, 'agent', messageId)
        msg.thinking += String(payload.thinking || '')
        break
      }
      case 'tool.call': {
        pending = flushPendingTimelineMessage(items, pending)
        const toolCall = payload.toolCall as ToolCallInfo | undefined
        if (!toolCall?.id) break
        toolIndexById.set(toolCall.id, items.length)
        items.push({
          id: `timeline-tool-${toolCall.id}-${event.sequence}`,
          kind: 'tool',
          role: 'agent',
          toolCall,
          timestamp: event.created_at,
          messageId,
        })
        break
      }
      case 'tool.update': {
        const update = payload.toolCall as ToolCallInfo | undefined
        if (!update?.id) break
        const index = toolIndexById.get(update.id)
        if (index == null) {
          if (!shouldCreateToolFromUpdate(update)) break
          pending = flushPendingTimelineMessage(items, pending)
          toolIndexById.set(update.id, items.length)
          items.push({
            id: `timeline-tool-${update.id}-${event.sequence}`,
            kind: 'tool',
            role: 'agent',
            toolCall: update,
            timestamp: event.created_at,
            messageId,
          })
          break
        }
        const item = items[index]
        if (item?.kind === 'tool') item.toolCall = mergeToolCall(item.toolCall, update)
        break
      }
      case 'message.done': {
        pending = flushPendingTimelineMessage(items, pending)
        if (payload.turnUsage) {
          const lastMessage = [...items].reverse().find((item): item is ChatTimelineMessageItem => item.kind === 'message' && item.role === 'agent')
          if (lastMessage) lastMessage.turnStats = payload.turnUsage as TurnUsageInfo
        }
        break
      }
    }
  }

  flushPendingTimelineMessage(items, pending)
  return items
}

export function groupChatTimelineItems(items: ChatTimelineItem[]): ChatTimelineGroup[] {
  const groups: ChatTimelineGroup[] = []

  for (const item of items) {
    const current = groups[groups.length - 1]
    if (current && current.role === item.role && current.messageId === item.messageId) {
      current.blocks.push(item)
      continue
    }

    groups.push({
      id: `timeline-group-${item.messageId || item.id}`,
      role: item.role,
      timestamp: item.timestamp,
      messageId: item.messageId,
      blocks: [item],
    })
  }

  return groups
}

const visibleLifecycleEvents = new Set([
  'lifecycle.runtime_starting',
  'lifecycle.session_creating',
  'lifecycle.session_created',
  'lifecycle.session_resuming',
  'lifecycle.session_resumed',
  'lifecycle.prompt_sent',
  'lifecycle.failed',
])

function applyHiddenLifecycle(streaming: StreamingMessage | null): StreamingMessage | null {
  if (!streaming || turnHasFinalizableContent(streaming)) return streaming
  return null
}

export function shouldShowLifecycleStage(eventType: string): boolean {
  return visibleLifecycleEvents.has(eventType)
}

export function applySessionEvent(state: ReducedSessionEvents, event: SessionEventData): ReducedSessionEvents {
  const payload = parsePayload(event)
  let streaming = state.streamingMessage
  let capabilities = state.capabilities
  let pendingPermissions = state.pendingPermissions
  let pendingElicitations = state.pendingElicitations

  const ensureStreaming = (messageId: string) => {
    if (!streaming || streaming.done || streaming.id !== messageId) streaming = emptyStreamingMessage(messageId)
    return streaming
  }

  if (event.type.startsWith('lifecycle.')) {
    if (!shouldShowLifecycleStage(event.type)) {
      return { ...state, streamingMessage: applyHiddenLifecycle(streaming), capabilities, pendingPermissions, pendingElicitations }
    }
    const msg = ensureStreaming(String(payload.messageId || event.message_id || event.id))
    streaming = applyTurnEntry(msg, { kind: 'stage', text: String(payload.content || payload.contentDelta || '') })
    return { ...state, streamingMessage: streaming, capabilities, pendingPermissions, pendingElicitations }
  }

  switch (event.type) {
    case 'message.chunk': {
      if (payload.role !== 'agent') break
      const msg = ensureStreaming(String(payload.messageId || event.message_id || event.id))
      streaming = applyTurnEntry(msg, { kind: 'reply', text: String(payload.contentDelta || payload.content || '') })
      break
    }
    case 'thinking.chunk': {
      const msg = ensureStreaming(String(payload.messageId || event.message_id || event.id))
      streaming = applyTurnEntry(msg, { kind: 'thinking', text: String(payload.thinking || '') })
      break
    }
    case 'tool.call': {
      const msg = ensureStreaming(String(payload.messageId || event.message_id || event.id))
      streaming = applyTurnEntry(msg, { kind: 'toolCall', toolCall: payload.toolCall as ToolCallInfo })
      break
    }
    case 'tool.update': {
      const update = payload.toolCall as ToolCallInfo
      if (streaming?.processBlocks.some(block => block.kind === 'tool' && block.toolCall.id === update.id) || shouldCreateToolFromUpdate(update)) {
        const msg = ensureStreaming(String(payload.messageId || event.message_id || event.id))
        streaming = applyTurnEntry(msg, { kind: 'toolUpdate', toolCall: update })
      }
      break
    }
    case 'message.done': {
      if (streaming) streaming = applyTurnEntry(streaming, { kind: 'done', turnStats: payload.turnUsage as TurnUsageInfo | undefined })
      if (payload.turnUsage) state = { ...state, turnUsage: payload.turnUsage as TurnUsageInfo }
      state = { ...state, plan: finalizePlanOnTurnDone(state.plan, payload.stopReason as string | undefined) }
      break
    }
    case 'usage.update':
      state = { ...state, usage: payload.usage as UsageInfo }
      break
    case 'plan.update':
      state = { ...state, plan: (payload.plan as PlanEntry[]) || [] }
      break
    case 'config.update':
      capabilities = capabilitiesFromConfig(capabilities, (payload.configOptions as ConfigOptionInfo[]) || [])
      break
    case 'commands.update':
      capabilities = { ...capabilities, commands: (payload.commands as AvailableCommandInfo[]) || [] }
      break
    case 'session.info':
      capabilities = { ...capabilities, sessionInfo: payload.sessionInfo as SessionInfoData }
      break
    case 'permission.request':
      pendingPermissions = [...pendingPermissions.filter(p => p.id !== (payload.permissionRequest as PermissionRequestInfo).id), payload.permissionRequest as PermissionRequestInfo]
      break
    case 'permission.result':
      pendingPermissions = pendingPermissions.filter(p => p.id !== payload.requestId)
      break
    case 'elicitation.request':
      pendingElicitations = [...pendingElicitations.filter(p => p.id !== (payload.elicitationRequest as ElicitationRequestInfo).id), payload.elicitationRequest as ElicitationRequestInfo]
      break
    case 'elicitation.result':
      pendingElicitations = pendingElicitations.filter(p => p.id !== payload.requestId)
      break
  }

  return { ...state, streamingMessage: streaming && !streaming.done ? streaming : null, capabilities, pendingPermissions, pendingElicitations }
}


function emptyStreamingMessage(messageId: string): StreamingMessage {
  return createEmptyTurn(messageId)
}

export function completedStreamingFromEvents(events: SessionEventData[]): StreamingMessage | null {
  const turns: StreamingMessage[] = []
  let current: StreamingMessage | null = null

  const ensureTurn = (messageId: string) => {
    if (!current || current.done || current.id !== messageId) {
      current = emptyStreamingMessage(messageId)
      turns.push(current)
    }
    return current
  }

  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const payload = parsePayload(event)
    const explicitMessageId = payloadMessageId(event, payload)
    const messageId = explicitMessageId || current?.id || event.id

    switch (event.type) {
      case 'message.chunk': {
        if (payload.role !== 'agent') break
        current = applyTurnEntry(ensureTurn(messageId), {
          kind: 'reply',
          text: String(payload.contentDelta || payload.content || ''),
          sequence: event.sequence,
        })
        turns[turns.length - 1] = current
        break
      }
      case 'thinking.chunk': {
        current = applyTurnEntry(ensureTurn(messageId), {
          kind: 'thinking',
          text: String(payload.thinking || ''),
          sequence: event.sequence,
        })
        turns[turns.length - 1] = current
        break
      }
      case 'tool.call': {
        const toolCall = payload.toolCall as ToolCallInfo | undefined
        if (!toolCall?.id) break
        current = applyTurnEntry(ensureTurn(messageId), { kind: 'toolCall', toolCall, sequence: event.sequence })
        turns[turns.length - 1] = current
        break
      }
      case 'tool.update': {
        const toolCall = payload.toolCall as ToolCallInfo | undefined
        if (!toolCall?.id) break
        const target = ensureTurn(messageId)
        if (!target.processBlocks.some(block => block.kind === 'tool' && block.toolCall.id === toolCall.id) && !shouldCreateToolFromUpdate(toolCall)) break
        current = applyTurnEntry(target, { kind: 'toolUpdate', toolCall, sequence: event.sequence })
        turns[turns.length - 1] = current
        break
      }
      case 'message.done': {
        if (!current || !turnHasFinalizableContent(current)) break
        current = applyTurnEntry(current, {
          kind: 'done',
          turnStats: payload.turnUsage as TurnUsageInfo | undefined,
          sequence: event.sequence,
        })
        turns[turns.length - 1] = current
        break
      }
    }
  }

  const finalizable = turns.filter(turnHasFinalizableContent)
  const completed = finalizable.filter((turn) => turn.done)
  return completed.at(-1) || finalizable.at(-1) || null
}


export function buildCompletedAgentMessage(sessionId: string, events: SessionEventData[], turnUsage?: TurnUsageInfo, costAmount?: number, elapsedSeconds?: number): MessageData | null {
  const msg = completedStreamingFromEvents(events)
  if (!msg) return null
  const decision = turnUsage ? { ...turnUsage, costAmount, elapsedSeconds } : null
  const process = flattenProcessText(msg)
  return {
    id: msg.id,
    session_id: sessionId,
    role: 'agent',
    content: msg.finalAnswer,
    thinking: process.thinking || null,
    tool_calls_json: process.toolCalls.length > 0 ? JSON.stringify(process.toolCalls) : null,
    decision_json: decision ? JSON.stringify(decision) : null,
    attachments_json: null,
    timestamp: new Date().toISOString(),
  }
}

export function reduceSessionEvents(events: SessionEventData[]): ReducedSessionEvents {
  return [...events].sort((a, b) => a.sequence - b.sequence).reduce(applySessionEvent, {
    streamingMessage: null,
    usage: null,
    turnUsage: null,
    capabilities: { ...defaultCaps },
    plan: [],
    pendingPermissions: [],
    pendingElicitations: [],
  })
}
