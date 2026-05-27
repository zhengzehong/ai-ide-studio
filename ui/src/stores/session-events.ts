export interface ImageAttachmentInfo {
  data: string
  mimeType: string
  name?: string
}

export interface MessageData {
  id: string; session_id: string; role: string; content: string
  thinking: string | null; tool_calls_json: string | null; decision_json: string | null; attachments_json?: string | null; timestamp: string
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

export interface StreamingMessage {
  id: string; role: 'agent'; content: string; thinking: string; toolCalls: ToolCallInfo[]; done: boolean
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


export function mergeMessagesById(serverMessages: MessageData[], currentMessages: MessageData[]): MessageData[] {
  const byId = new Map<string, MessageData>()
  for (const msg of currentMessages) byId.set(msg.id, msg)
  for (const msg of serverMessages) byId.set(msg.id, msg)
  return Array.from(byId.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

export function appendFinalizedMessage(currentMessages: MessageData[], message: MessageData): MessageData[] {
  if (!currentMessages.some(m => m.id === message.id)) return [...currentMessages, message]

  const suffixBase = Date.parse(message.timestamp) || Date.now()
  let nextId = `${message.id}-${suffixBase}`
  let i = 1
  while (currentMessages.some(m => m.id === nextId)) {
    i += 1
    nextId = `${message.id}-${suffixBase}-${i}`
  }
  return [...currentMessages, { ...message, id: nextId }]
}

export function mergeToolCall(existing: ToolCallInfo, update: ToolCallInfo): ToolCallInfo {
  const next: ToolCallInfo = { ...existing }
  if (update.title) next.title = update.title
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

function parsePayload(event: SessionEventData): Record<string, unknown> {
  try { return JSON.parse(event.payload_json) as Record<string, unknown> } catch { return {} }
}

function applyEvent(state: ReducedSessionEvents, event: SessionEventData): ReducedSessionEvents {
  const payload = parsePayload(event)
  let streaming = state.streamingMessage ? { ...state.streamingMessage, toolCalls: [...state.streamingMessage.toolCalls] } : state.streamingMessage
  let capabilities = state.capabilities
  let pendingPermissions = state.pendingPermissions
  let pendingElicitations = state.pendingElicitations

  const ensureStreaming = (messageId: string) => {
    if (!streaming || streaming.done || streaming.id !== messageId) streaming = emptyStreamingMessage(messageId)
    return streaming
  }

  switch (event.type) {
    case 'message.chunk': {
      if (payload.role !== 'agent') break
      const msg = ensureStreaming(String(payload.messageId || event.message_id || event.id))
      msg.content += String(payload.contentDelta || payload.content || '')
      break
    }
    case 'thinking.chunk': {
      const msg = ensureStreaming(String(payload.messageId || event.message_id || event.id))
      msg.thinking += String(payload.thinking || '')
      break
    }
    case 'tool.call': {
      const msg = ensureStreaming(String(payload.messageId || event.message_id || event.id))
      msg.toolCalls.push(payload.toolCall as ToolCallInfo)
      break
    }
    case 'tool.update': {
      const msg = ensureStreaming(String(payload.messageId || event.message_id || event.id))
      const update = payload.toolCall as ToolCallInfo
      const idx = msg.toolCalls.findIndex(t => t.id === update.id)
      if (idx >= 0) msg.toolCalls[idx] = mergeToolCall(msg.toolCalls[idx], update)
      else msg.toolCalls.push(update)
      break
    }
    case 'message.done': {
      if (streaming) streaming.done = true
      if (payload.turnUsage) state = { ...state, turnUsage: payload.turnUsage as TurnUsageInfo }
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
  return { id: messageId, role: 'agent', content: '', thinking: '', toolCalls: [], done: false }
}

export function completedStreamingFromEvents(events: SessionEventData[]): StreamingMessage | null {
  const messages: StreamingMessage[] = []
  const activeById = new Map<string, StreamingMessage>()
  let lastMessageId: string | null = null
  let lastMessage: StreamingMessage | null = null

  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const payload = parsePayload(event)
    const messageId = String(payload.messageId || event.message_id || lastMessageId || event.id)
    const ensure = () => {
      let msg = activeById.get(messageId)
      if (!msg || msg.done) {
        msg = emptyStreamingMessage(messageId)
        activeById.set(messageId, msg)
        messages.push(msg)
      }
      lastMessageId = messageId
      lastMessage = msg
      return msg
    }

    switch (event.type) {
      case 'message.chunk': {
        if (payload.role !== 'agent') break
        const msg = ensure()
        msg.content += String(payload.contentDelta || payload.content || '')
        break
      }
      case 'thinking.chunk': {
        const msg = ensure()
        msg.thinking += String(payload.thinking || '')
        break
      }
      case 'tool.call': {
        const msg = ensure()
        msg.toolCalls.push(payload.toolCall as ToolCallInfo)
        break
      }
      case 'tool.update': {
        const msg = ensure()
        const update = payload.toolCall as ToolCallInfo
        const idx = msg.toolCalls.findIndex(t => t.id === update.id)
        if (idx >= 0) msg.toolCalls[idx] = mergeToolCall(msg.toolCalls[idx], update)
        else msg.toolCalls.push(update)
        break
      }
      case 'message.done': {
        const msg = activeById.get(messageId) || lastMessage
        if (msg) msg.done = true
        break
      }
    }
  }

  const completed = messages.filter(msg => msg.done && (msg.content || msg.thinking || msg.toolCalls.length > 0))
  if (completed.length > 0) return completed.at(-1) || null

  const partial = messages.filter(msg => msg.content || msg.thinking || msg.toolCalls.length > 0)
  return partial.at(-1) || null
}

export function buildCompletedAgentMessage(sessionId: string, events: SessionEventData[], turnUsage?: TurnUsageInfo, costAmount?: number, elapsedSeconds?: number): MessageData | null {
  const msg = completedStreamingFromEvents(events)
  if (!msg) return null
  const decision = turnUsage ? { ...turnUsage, costAmount, elapsedSeconds } : null
  return {
    id: msg.id,
    session_id: sessionId,
    role: 'agent',
    content: msg.content,
    thinking: msg.thinking || null,
    tool_calls_json: msg.toolCalls.length > 0 ? JSON.stringify(msg.toolCalls) : null,
    decision_json: decision ? JSON.stringify(decision) : null,
    attachments_json: null,
    timestamp: new Date().toISOString(),
  }
}

export function reduceSessionEvents(events: SessionEventData[]): ReducedSessionEvents {
  return events.sort((a, b) => a.sequence - b.sequence).reduce(applyEvent, {
    streamingMessage: null,
    usage: null,
    turnUsage: null,
    capabilities: { ...defaultCaps },
    plan: [],
    pendingPermissions: [],
    pendingElicitations: [],
  })
}
