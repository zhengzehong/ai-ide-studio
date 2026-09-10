import type { MessageData, PermissionRequestInfo, ElicitationRequestInfo, SessionCapabilities, SessionEventData, StreamingMessage, TeamAssignmentInfo, ToolCallInfo, UsageInfo, ReducedSessionEvents, TurnProcessItemInfo } from '../../stores/session-events'
import { applySessionEvent, defaultCaps, mergeCapabilities, normalizeMessage } from '../../stores/session-events'
import { applyTurnEntry, createEmptyTurn, turnFromProcessItems, type TurnProcessBlock } from '../../stores/turn-blocks'
import { assignmentFromEvent, attachTeamAssignments } from './team-chat-assignments'

export interface Snapshot { sessionId: string; supplementalItems?: TurnProcessItemInfo[]; replayEvents?: SessionEventData[]; replaySequence?: number; senderName?: string; messages: MessageData[]; events: SessionEventData[]; streaming: StreamingMessage | null; pendingAssignment?: TeamAssignmentInfo | null; permissions: PermissionRequestInfo[]; elicitations: ElicitationRequestInfo[]; capabilities: SessionCapabilities; usage: UsageInfo | null; hasMore: boolean; running: boolean }

export function aggregateSnapshots(snapshots: Record<string, Snapshot>, ids: string[], masterSessionId: string | null) {
  const decoratedBySession = new Map<string, { messages: MessageData[]; streaming: StreamingMessage | null }>()
  ids.forEach((id) => {
    const snapshot = snapshots[id]
    if (snapshot) decoratedBySession.set(id, attachTeamAssignments(snapshot.messages, snapshot.streaming))
  })
  const messages = [...new Map(ids.flatMap((id) => {
    const items = decoratedBySession.get(id)?.messages || []
    return id === masterSessionId ? items : items.filter((message) => message.role !== 'human')
  }).map((message) => [message.id, message])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
  const events = [...new Map(ids.flatMap((id) => snapshots[id]?.events || []).map((event) => [event.id, event])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.sequence - b.sequence)
  const streaming = [...new Map(ids.flatMap((id) => {
    const item = decoratedBySession.get(id)?.streaming
    return item && !item.done ? [[`${id}:${item.id}`, remapStreaming(item, id, snapshots[id]?.senderName)] as const] : []
  })).values()]
  const capabilities = masterSessionId ? snapshots[masterSessionId]?.capabilities || { ...defaultCaps } : { ...defaultCaps }
  return { messages, events, streaming, capabilities, usage: masterSessionId ? snapshots[masterSessionId]?.usage || null : null, permissions: uniqueById(ids.flatMap((id) => snapshots[id]?.permissions || [])), elicitations: uniqueById(ids.flatMap((id) => snapshots[id]?.elicitations || [])), running: ids.some((id) => snapshots[id]?.running), hasMore: ids.some((id) => snapshots[id]?.hasMore) }
}
function uniqueById<T extends { id: string }>(items: T[]): T[] { return [...new Map(items.map((item) => [item.id, item])).values()] }
export function emptySnapshot(sessionId: string): Snapshot { return { sessionId, messages: [], events: [], streaming: null, pendingAssignment: null, permissions: [], elicitations: [], capabilities: { ...defaultCaps }, usage: null, hasMore: false, running: false } }
export function restoreTeamSnapshot(snapshot: Snapshot, events: SessionEventData[], sequence: number): Snapshot {
  const active = snapshot.messages.filter(message => message.role === 'agent' && message.status === 'running').at(-1)
  let state = { ...snapshot, streaming: active ? toStreaming(active, snapshot.sessionId) : null, running: !!active, replaySequence: 0, replayEvents: [] as SessionEventData[] }
  if (active && events.length) {
    state.streaming = { ...createEmptyTurn(state.streaming!.id), startedAt: active.timestamp, senderName: snapshot.senderName, teamAssignment: active.teamAssignment }
    let current: Record<string, Snapshot> = { [snapshot.sessionId]: state }
    // Build the turn without copying the entire event history for every chunk.
    for (const event of events) {
      current[snapshot.sessionId] = { ...current[snapshot.sessionId], events: [] }
      current = applyRawEventToSnapshot(current, snapshot.sessionId, event, active.session_id)
    }
    const history = [...new Map([...snapshot.events, ...events.map(event => remapEvent(event, snapshot.sessionId, active.session_id))].map(event => [event.id, event])).values()]
    state = { ...state, ...current[snapshot.sessionId], events: history, replaySequence: events.at(-1)?.sequence || 0, replayEvents: events }
  }
  return { ...state, replaySequence: Math.max(sequence, state.replaySequence) }
}

export function mergeLoadedSnapshots(current: Record<string, Snapshot>, loaded: Record<string, Snapshot>): Record<string, Snapshot> {
  const merged: Record<string, Snapshot> = { ...current }
  Object.entries(loaded).forEach(([sessionId, loadedSnapshot]) => {
    const previous = current[sessionId]
    let next = loadedSnapshot
    // HTTP/RPC history and live events overlap. Only replay events beyond the loaded boundary.
    if (previous && next.replaySequence !== undefined) {
      let replayed = { [sessionId]: next }
      const target = next.messages[0]?.session_id || previous.messages[0]?.session_id || sessionId
      for (const event of previous.replayEvents || []) {
        if (event.sequence > next.replaySequence) replayed = applyEventToSnapshot(replayed, sessionId, event, target)
      }
      next = replayed[sessionId]
    }
    const messages = new Map((previous?.messages || []).map(message => [message.id, message]))
    next.messages.forEach(message => {
      const existing = messages.get(message.id)
      messages.set(message.id, existing ? mergeMessage(existing, message) : message)
    })
    const allMessages = [...messages.values()]
    const candidate = next.replaySequence !== undefined ? next.streaming
      : hasLiveStreaming(previous) ? previous!.streaming : next.streaming || previous?.streaming || null
    const completed = hasCompletedTurn(allMessages, candidate, sessionId)
    const supplementalItems = mergeSupplementalItems(previous?.supplementalItems || [], next.supplementalItems || [])
    const streaming = completed ? null : overlaySupplementalItems(candidate, supplementalItems)
    merged[sessionId] = {
      ...previous, ...next,
      messages: allMessages.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)),
      events: [...new Map([...(previous?.events || []), ...next.events].map(event => [event.id, event])).values()].sort((a, b) => a.sequence - b.sequence),
      streaming, supplementalItems,
      running: !!streaming || (!completed && next.replaySequence === undefined && (previous?.running || next.running) && !hasCompletedTurn(allMessages, previous?.streaming || null, sessionId)),
      hasMore: next.messages.length ? next.hasMore : previous?.hasMore || false,
    }
  })
  return merged
}

export function finalizeSnapshot(current: Record<string, Snapshot>, sessionId: string, messageId: string, targetSessionId: string | null = sessionId, status = 'completed', error?: string): Record<string, Snapshot> {
  const snapshot = current[sessionId]
  if (!snapshot) return current
  if (snapshot.streaming && snapshot.streaming.id !== messageId && hasCompletedTurn(snapshot.messages, createEmptyTurn(messageId), sessionId)) return current
  const streaming = snapshot.streaming || recoverStreamingSnapshot(snapshot, sessionId, messageId)
  if (!streaming) {
    const existing = findTurnMessage(snapshot.messages, sessionId, messageId)
    if (existing && (existing.content.trim() || existing.finalAnswer?.trim() || existing.processBlocks?.length)) {
      const existingContent = status === 'failed' && error ? appendFailureText(existing.content || existing.finalAnswer || '', error) : existing.content
      const completed = normalizeMessage({
        ...existing,
        session_id: targetSessionId || existing.session_id,
        content: existingContent,
        finalAnswer: status === 'failed' && error ? existingContent : existing.finalAnswer,
        status,
        completed_at: existing.completed_at || new Date().toISOString(),
        teamAssignment: existing.teamAssignment ?? snapshot.pendingAssignment ?? undefined,
      })
      const messages = new Map(snapshot.messages.map((message) => [message.id, message]))
      messages.set(existing.id, completed)
      return { ...current, [sessionId]: { ...snapshot, messages: [...messages.values()], pendingAssignment: null, running: false } }
    }
    if (status !== 'failed' || !error) return { ...current, [sessionId]: { ...snapshot, pendingAssignment: null, running: false } }
    const id = `${sessionId}:${messageId.startsWith(`${sessionId}:`) ? messageId.slice(sessionId.length + 1) : messageId}`
    const failed = normalizeMessage({ id, session_id: targetSessionId || snapshot.sessionId, role: 'agent', content: `执行失败：${error}`, thinking: null, tool_calls_json: null, decision_json: null, attachments_json: null, timestamp: new Date().toISOString(), status: 'failed', completed_at: new Date().toISOString(), sender_name: snapshot.senderName || null, sender_role: 'member', teamAssignment: snapshot.pendingAssignment ?? undefined, processDefaultOpen: false })
    const messages = new Map(snapshot.messages.map((message) => [message.id, message]))
    messages.set(id, failed)
    return { ...current, [sessionId]: { ...snapshot, messages: [...messages.values()], pendingAssignment: null, running: false } }
  }
  const normalizedMessageId = messageId.startsWith(`${sessionId}:`) ? messageId.slice(sessionId.length + 1) : messageId
  const streamingId = streaming.id.startsWith(`${sessionId}:`) ? streaming.id.slice(sessionId.length + 1) : streaming.id
  // ACP implementations may use different identifiers for the update stream and done envelope.
  // A session has only one active turn, so preserve that turn even when the ids differ.
  const resolvedMessageId = streamingId === normalizedMessageId ? normalizedMessageId : streamingId
  const id = `${sessionId}:${resolvedMessageId}`
  const streamContent = streaming.finalAnswer || streaming.content
  const completedContent = status === 'failed' && error ? appendFailureText(streamContent, error) : streamContent
  const completed = normalizeMessage({
    id,
    // The shared conversation list filters by the display session (Master).
    // Keep the source-prefixed message id for cross-agent de-duplication, but
    // normalize its session id to the display target just like loaded history.
    session_id: targetSessionId || snapshot.sessionId,
    role: 'agent',
    content: completedContent,
    thinking: streaming.thinking,
    tool_calls_json: streaming.toolCalls.length ? JSON.stringify(streaming.toolCalls) : null,
    decision_json: streaming.turnStats ? JSON.stringify(streaming.turnStats) : null,
    attachments_json: null,
    file_changes_json: null,
    // 落库的 agent 消息时间戳取回合开始时刻;live 完成也用开始时间,避免并发回合(成员回复 vs Master 总结)短暂错序。
    timestamp: streaming.startedAt || new Date().toISOString(),
    status,
    completed_at: new Date().toISOString(),
    processBlocks: streaming.processBlocks,
    finalAnswer: completedContent,
    parsedToolCalls: streaming.toolCalls,
    sender_name: snapshot.senderName || null,
    sender_role: 'member',
    teamAssignment: streaming.teamAssignment ?? snapshot.pendingAssignment ?? undefined,
    processDefaultOpen: false,
  })
  const messages = new Map(snapshot.messages.map((message) => [message.id, message]))
  const existing = findTurnMessage(snapshot.messages, sessionId, resolvedMessageId)
  messages.set(id, existing ? mergeMessage(existing, completed) : completed)
  return { ...current, [sessionId]: { ...snapshot, messages: [...messages.values()], streaming: null, running: false } }
}

export function findTurnMessage(messages: MessageData[], sessionId: string, messageId: string): MessageData | undefined {
  const rawId = messageId.startsWith(`${sessionId}:`) ? messageId.slice(sessionId.length + 1) : messageId
  return messages.find((message) => message.id === `${sessionId}:${rawId}` || message.id === rawId)
}

function appendFailureText(content: string, error: string): string {
  const suffix = `执行失败：${error}`
  return content.trim() ? `${content}\n\n${suffix}` : suffix
}

function recoverStreamingSnapshot(snapshot: Snapshot, sessionId: string, messageId: string): StreamingMessage | null {
  const existing = findTurnMessage(snapshot.messages, sessionId, messageId)
  if (existing && (existing.content.trim() || existing.finalAnswer?.trim() || existing.processBlocks?.length)) return toStreaming(existing, sessionId)
  if (snapshot.events.length === 0) return null
  const reduced = reduceRecovery(snapshot.events.filter((event) => event.type !== 'message.done'))
  const recovered = reduced.streamingMessage
  if (!recovered) return null
  const rawId = messageId.startsWith(`${sessionId}:`) ? messageId.slice(sessionId.length + 1) : messageId
  const recoveredId = recovered.id.startsWith(`${sessionId}:`) ? recovered.id.slice(sessionId.length + 1) : recovered.id
  return recoveredId === rawId ? recovered : null
}

export function mergeMessage(previous: MessageData, next: MessageData): MessageData {
  const nextHasContent = next.content.trim().length > 0
  const nextHasFinalAnswer = !!next.finalAnswer?.trim()
  const status = ['completed', 'failed', 'cancelled'].includes(previous.status || '') && next.status === 'running' ? previous.status : next.status || previous.status
  return {
    ...previous,
    ...next,
    content: nextHasContent ? next.content : previous.content,
    status,
    completed_at: next.completed_at || previous.completed_at,
    processBlocks: next.processBlocks?.length ? next.processBlocks : previous.processBlocks,
    parsedToolCalls: next.parsedToolCalls?.length ? next.parsedToolCalls : previous.parsedToolCalls,
    finalAnswer: nextHasFinalAnswer ? next.finalAnswer : previous.finalAnswer,
  }
}

export function hasCompletedTurn(messages: MessageData[], streaming: StreamingMessage | null, sessionId: string): boolean {
  if (!streaming) return false
  const rawId = streaming.id.startsWith(`${sessionId}:`) ? streaming.id.slice(sessionId.length + 1) : streaming.id
  return messages.some((message) => {
    if (message.id !== `${sessionId}:${rawId}` && message.id !== rawId) return false
    return ['completed', 'failed', 'cancelled'].includes(message.status || '') || !!message.completed_at
  })
}
export function toStreaming(message: MessageData, sessionId: string): StreamingMessage { const id = message.id.startsWith(`${sessionId}:`) ? message.id.slice(sessionId.length + 1) : message.id; return { ...createEmptyTurn(id), startedAt: message.timestamp, content: message.content, finalAnswer: message.finalAnswer || message.content, processBlocks: message.processBlocks || [], toolCalls: message.parsedToolCalls || [], senderName: message.sender_name || undefined, teamAssignment: message.teamAssignment, done: false } }
function remapStreaming(streaming: StreamingMessage, sessionId: string, senderName?: string): StreamingMessage { const id = streaming.id.startsWith(`${sessionId}:`) ? streaming.id : `${sessionId}:${streaming.id}`; return { ...streaming, id, senderName: senderName || streaming.senderName } }
/** 保留同一回合已记录的开始时间;新回合以当前时刻作为开始时间,供 finalize 用它对齐落库时间戳。 */
function withTurnStart(previous: StreamingMessage | null, next: StreamingMessage): StreamingMessage { return { ...next, startedAt: previous && previous.id === next.id && previous.startedAt ? previous.startedAt : new Date().toISOString() } }
export function normalizeCapabilities(value: unknown): SessionCapabilities { if (!value || typeof value !== 'object') return { ...defaultCaps }; const input = value as Partial<SessionCapabilities>; return mergeCapabilities({ ...defaultCaps }, { ...defaultCaps, models: Array.isArray(input.models) ? input.models : [], currentModelId: typeof input.currentModelId === 'string' ? input.currentModelId : null, modes: Array.isArray(input.modes) ? input.modes : [], currentModeId: typeof input.currentModeId === 'string' ? input.currentModeId : null, supportsImages: input.supportsImages === true, configOptions: Array.isArray(input.configOptions) ? input.configOptions : [], commands: Array.isArray(input.commands) ? input.commands : [] }) }
export function remapEvent(event: SessionEventData, sourceSessionId: string, targetSessionId: string): SessionEventData { const parsed = (() => { try { return JSON.parse(event.payload_json) as Record<string, unknown> } catch { return null } })(); const payload = parsed || {}; if (typeof payload.messageId === 'string') payload.messageId = `${sourceSessionId}:${payload.messageId}`; return { ...event, id: `${sourceSessionId}:${event.id}`, session_id: targetSessionId, message_id: event.message_id ? `${sourceSessionId}:${event.message_id}` : event.message_id, payload_json: JSON.stringify(payload) } }
export function reduceRecovery(events: SessionEventData[]): ReducedSessionEvents { return events.reduce<ReducedSessionEvents>((state, event) => applySessionEvent(state, event), { streamingMessage: null, usage: null, turnUsage: null, capabilities: { ...defaultCaps }, plan: [], pendingPermissions: [], pendingElicitations: [] }) }

/** 方案3:重建事件窗口上限(与服务端 MAX_EVENT_LIMIT 对齐)。 */
export const TEAM_STREAM_REBUILD_EVENT_LIMIT = 1000
/** 判定 session 是否持有"真实"流式内容(有文本或过程块)——空壳(content 空 + 无过程块)不算,允许被重建覆盖。 */
export function hasLiveStreaming(snapshot: Snapshot | undefined): boolean {
  const streaming = snapshot?.streaming
  return !!streaming && !streaming.done && (streaming.content.trim() !== '' || streaming.processBlocks.length > 0)
}
/** 用全量事件历史(含 chunk)重建 in-flight 回合:applySessionEvent 对 message.done 会置空、新 messageId 重开 turn,折叠加载后恰好只剩未完成回合。 */
export function rebuildStreamingFromEvents(events: SessionEventData[]): StreamingMessage | null {
  return events.length ? reduceRecovery(events).streamingMessage : null
}
export function updateStreaming(current: Record<string, Snapshot>, sessionId: string, data: Record<string, unknown>): Record<string, Snapshot> { const snapshot = current[sessionId] || emptySnapshot(sessionId); const incomingId = typeof data.messageId === 'string' ? data.messageId : snapshot.streaming?.id || `team-${sessionId}`; let turn = snapshot.streaming && !snapshot.streaming.done && snapshot.streaming.id === incomingId ? snapshot.streaming : createEmptyTurn(incomingId); turn = withTurnStart(snapshot.streaming && snapshot.streaming.id === incomingId ? snapshot.streaming : null, turn); turn = { ...turn, senderName: snapshot.senderName, teamAssignment: snapshot.pendingAssignment || turn.teamAssignment }; if (typeof data.contentDelta === 'string') turn = applyTurnEntry(turn, { kind: 'reply', text: data.contentDelta }); if (typeof data.thinking === 'string') turn = applyTurnEntry(turn, { kind: 'thinking', text: data.thinking }); if (data.toolCall && typeof data.toolCall === 'object') turn = applyTurnEntry(turn, { kind: 'toolCall', toolCall: data.toolCall as ToolCallInfo }); if (data.toolCallUpdate && typeof data.toolCallUpdate === 'object') turn = applyTurnEntry(turn, { kind: 'toolUpdate', toolCall: data.toolCallUpdate as ToolCallInfo }); return { ...current, [sessionId]: { ...snapshot, streaming: turn, running: true } } }
function applyRawEventToSnapshot(current: Record<string, Snapshot>, sessionId: string, event: SessionEventData, targetSessionId: string | null): Record<string, Snapshot> { const snapshot = current[sessionId] || emptySnapshot(sessionId); const displayEventId = `${sessionId}:${event.id}`; if (snapshot.events.some((item) => item.id === displayEventId)) return current; const reduced = applySessionEvent({ streamingMessage: snapshot.streaming, usage: snapshot.usage, turnUsage: null, capabilities: snapshot.capabilities, plan: [], pendingPermissions: snapshot.permissions, pendingElicitations: snapshot.elicitations }, event); const events = [...snapshot.events, remapEvent(event, sessionId, targetSessionId || sessionId)]; if (event.type === 'message.done' && snapshot.streaming) { const payload = parseEventPayload(event); const turnUsage = payload?.turnUsage && typeof payload.turnUsage === 'object' && !Array.isArray(payload.turnUsage) ? payload.turnUsage as StreamingMessage['turnStats'] : snapshot.streaming.turnStats; const messageId = typeof payload?.messageId === 'string' ? payload.messageId : event.message_id || snapshot.streaming.id; const status = payload?.stopReason === 'error' ? 'failed' : payload?.stopReason === 'cancelled' ? 'cancelled' : 'completed'; const error = typeof payload?.error === 'string' ? payload.error : undefined; const completedState = { ...current, [sessionId]: { ...snapshot, events, streaming: { ...snapshot.streaming, turnStats: turnUsage }, usage: reduced.usage, permissions: reduced.pendingPermissions, elicitations: reduced.pendingElicitations, running: false } }; return finalizeSnapshot(completedState, sessionId, messageId, targetSessionId, status, error) } return { ...current, [sessionId]: { ...snapshot, events, streaming: reduced.streamingMessage ? withTurnStart(snapshot.streaming && snapshot.streaming.id === reduced.streamingMessage.id ? snapshot.streaming : null, { ...reduced.streamingMessage, senderName: snapshot.senderName, teamAssignment: snapshot.pendingAssignment || reduced.streamingMessage.teamAssignment }) : null, usage: reduced.usage, permissions: reduced.pendingPermissions, elicitations: reduced.pendingElicitations, running: !!reduced.streamingMessage } } }

function parseEventPayload(event: SessionEventData): Record<string, unknown> | null { try { const payload = JSON.parse(event.payload_json) as unknown; return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null } catch { return null } }
const supplementalKinds = new Set(['plan', 'permission', 'elicitation', 'file_change'])

function mergeSupplementalItems(previous: TurnProcessItemInfo[], next: TurnProcessItemInfo[]): TurnProcessItemInfo[] {
  const items = new Map(previous.map(item => [item.id, item]))
  for (const item of next) {
    const old = items.get(item.id)
    if (!old || item.updated_at >= old.updated_at) items.set(item.id, item)
  }
  return [...items.values()]
}

function overlaySupplementalItems(turn: StreamingMessage | null, items: TurnProcessItemInfo[]): StreamingMessage | null {
  if (!turn) return null
  const extra = turnFromProcessItems(turn.id, items.filter(item => item.message_id === turn.id)).processBlocks
  if (!extra.length) return turn
  const ids = new Set(extra.map(block => block.id))
  return { ...turn, processBlocks: [...turn.processBlocks.filter(block => !ids.has(block.id)), ...extra] }
}

export function mergeProcessItem(current: Record<string, Snapshot>, sessionId: string, item: TurnProcessItemInfo, block: TurnProcessBlock): Record<string, Snapshot> {
  if (!supplementalKinds.has(block.kind)) return current
  const snapshot = current[sessionId] || emptySnapshot(sessionId)
  if (hasCompletedTurn(snapshot.messages, createEmptyTurn(item.message_id), sessionId)) return current
  const supplementalItems = mergeSupplementalItems(snapshot.supplementalItems || [], [item])
  return { ...current, [sessionId]: { ...snapshot, supplementalItems, streaming: overlaySupplementalItems(snapshot.streaming, supplementalItems) } }
}

export function applyEventToSnapshot(current: Record<string, Snapshot>, sessionId: string, event: SessionEventData, targetSessionId: string | null): Record<string, Snapshot> {
  const snapshot = current[sessionId] || emptySnapshot(sessionId)
  if (event.sequence <= (snapshot.replaySequence ?? 0)) return current
  const messageId = event.message_id || String(parseEventPayload(event)?.messageId || '')
  const terminal = hasCompletedTurn(snapshot.messages, messageId ? createEmptyTurn(messageId) : null, sessionId)
  const staleDone = event.type === 'message.done' && snapshot.streaming && messageId && snapshot.streaming.id !== messageId
  const assignment = assignmentFromEvent(event)
  const input = assignment ? { ...current, [sessionId]: { ...snapshot, pendingAssignment: assignment } } : current
  const result = terminal || staleDone ? input : applyRawEventToSnapshot(input, sessionId, event, targetSessionId)
  const next = result[sessionId] || snapshot
  return { ...result, [sessionId]: { ...next, streaming: overlaySupplementalItems(next.streaming, next.supplementalItems || []), replaySequence: event.sequence, replayEvents: [...(snapshot.replayEvents || []), event] } }
}
