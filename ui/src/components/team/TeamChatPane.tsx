/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConversationPane } from '../chat/ConversationPane'
import type { ConversationAdapter, ConversationUploadedFile, ConversationProcessState } from '../chat/conversation-types'
import type { FileChangeDetailInfo, ImageAttachmentInfo, MessageData, PermissionRequestInfo, ElicitationRequestInfo, SessionCapabilities, SessionEventData, StreamingMessage, TeamAssignmentInfo, ToolCallInfo, UsageInfo, ReducedSessionEvents, TurnProcessItemInfo } from '../../stores/session-events'
import { applySessionEvent, defaultCaps, mergeCapabilities, normalizeMessage } from '../../stores/session-events'
import { applyTurnEntry, createEmptyTurn, turnFromProcessItems, type TurnProcessBlock } from '../../stores/turn-blocks'
import { queryClient } from '../../services/query-client'
import { commandClient } from '../../services/command-client'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'
import { assignmentFromEvent, attachTeamAssignments, findPendingTeamAssignment, mapTeamMessage } from './team-chat-assignments'

interface Conversation { id: string; team_id: string; master_session_id: string; title: string }
interface Member { id: string; agent_id: string; session_id: string; name: string; role: string }
interface Props { team: TeamData; conversation: Conversation | null; masterSessionId: string | null }
interface SourceMessage { message: MessageData; sourceSessionId: string; sourceMessageId: string }
export interface Snapshot { sessionId: string; senderName?: string; messages: MessageData[]; events: SessionEventData[]; streaming: StreamingMessage | null; pendingAssignment?: TeamAssignmentInfo | null; permissions: PermissionRequestInfo[]; elicitations: ElicitationRequestInfo[]; capabilities: SessionCapabilities; usage: UsageInfo | null; hasMore: boolean; running: boolean }

export function TeamChatPane({ team, conversation, masterSessionId }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [processByMessageId, setProcessByMessageId] = useState<Record<string, ConversationProcessState>>({})
  const [fileChanges, setFileChanges] = useState<Record<string, FileChangeDetailInfo>>({})
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({})
  const sourceMap = useRef(new Map<string, SourceMessage>())
  const mirroredEvents = useRef(new Map<string, { expiresAt: number; updateCount: number; eventCount: number }>())
  const doneReloadTimers = useRef(new Map<string, number>())
  const generation = useRef(0)
  const sessionIds = useMemo(() => [...new Set([masterSessionId, ...members.map((member) => member.session_id)].filter((id): id is string => !!id))], [masterSessionId, members])

  const load = useCallback(async (): Promise<void> => {
    if (!conversation) { setMembers([]); setSnapshots({}); sourceMap.current.clear(); return }
    const requestGeneration = ++generation.current
    setLoading(true); setError(null)
    try {
      const detail = await wsClient.request({ type: 'team.conversation.history', conversationId: conversation.id }) as { members?: Member[] }
      const nextMembers = Array.isArray(detail.members) ? detail.members : []
      const ids = [...new Set([conversation.master_session_id, ...nextMembers.map((member) => member.session_id)].filter((id): id is string => !!id))]
      const labels = new Map<string, { name: string; role: string }>([[conversation.master_session_id, { name: 'Master', role: 'Master' }]])
      nextMembers.forEach((member) => labels.set(member.session_id, { name: member.name, role: member.role }))
      const nextSnapshots: Record<string, Snapshot> = {}
      const nextSource = new Map<string, SourceMessage>()
      await Promise.all(ids.map(async (sessionId) => {
        const [page, recovery, caps] = await Promise.all([
          queryClient.listSessionMessages({ sessionId, limit: 120, includeToolCalls: true, includeLatestToolCalls: true }),
          queryClient.getSessionRecovery({ sessionId, limit: 1000 }),
          wsClient.request({ type: 'session.getModels', sessionId }).catch(() => null),
        ])
        const label = labels.get(sessionId)
        const mapped = page.items.map((message) => {
          const mappedMessage = normalizeMessage(mapTeamMessage(message, sessionId, conversation.master_session_id, label?.name || 'Agent', label?.role || 'member'))
          const displayId = mappedMessage.id
          nextSource.set(displayId, { message: mappedMessage, sourceSessionId: sessionId, sourceMessageId: message.id })
          return mappedMessage
        })
        const decorated = attachTeamAssignments(mapped)
        const reduced = recovery.events.length ? reduceRecovery(recovery.events) : null
        const active = decorated.messages.filter((message) => message.role === 'agent' && message.status === 'running').at(-1)
        const pendingAssignment = active?.teamAssignment || findPendingTeamAssignment(mapped)
        const streaming = reduced?.streamingMessage ? { ...reduced.streamingMessage, senderName: label?.name || 'Agent', teamAssignment: pendingAssignment || undefined } : active ? { ...toStreaming(active, sessionId), teamAssignment: pendingAssignment || undefined } : null
        nextSnapshots[sessionId] = { sessionId, senderName: label?.name || 'Agent', messages: decorated.messages, events: recovery.events.map((event) => remapEvent(event, sessionId, conversation.master_session_id)), streaming: decorated.streaming || streaming, permissions: reduced?.pendingPermissions || [], elicitations: reduced?.pendingElicitations || [], capabilities: normalizeCapabilities(caps), usage: reduced?.usage || null, hasMore: page.hasMore, running: !!active || !!reduced?.streamingMessage }
      }))
      if (requestGeneration !== generation.current) return
      sourceMap.current = new Map([...sourceMap.current, ...nextSource])
      setMembers(nextMembers)
      setSnapshots((current) => mergeLoadedSnapshots(current, nextSnapshots))
    } catch (cause) { if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : '团队消息加载失败') }
    finally { if (requestGeneration === generation.current) setLoading(false) }
  }, [conversation])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    if (sessionIds.length === 0) return undefined
    wsClient.subscribe(sessionIds)
    const offUpdate = wsClient.on('session:update', (message) => {
      if (typeof message.sessionId !== 'string' || !sessionIds.includes(message.sessionId)) return
      const data = message.data as Record<string, unknown>
      if (data.permissionRequest || data.elicitationRequest) { void load(); return }
      if (data.contentDelta || data.thinking || data.toolCall || data.toolCallUpdate) {
        noteTeamRealtimeUpdate(mirroredEvents.current, message.sessionId as string, data)
        setSnapshots((current) => updateStreaming(current, message.sessionId as string, data))
      }
    })
    const offProcess = wsClient.on('session:process_item', (message) => {
      if (typeof message.sessionId !== 'string' || !sessionIds.includes(message.sessionId)) return
      const item = message.item as TurnProcessItemInfo
      const block = turnFromProcessItems(item.message_id, [item]).processBlocks[0]
      if (!block) return
      setSnapshots((current) => mergeProcessItem(current, message.sessionId as string, item, block))
    })
    const offEvent = wsClient.on('session:event', (message) => {
      if (typeof message.sessionId !== 'string' || !sessionIds.includes(message.sessionId)) return
      const event = message.event as SessionEventData
      const assignment = assignmentFromEvent(event)
      if (assignment) {
        setSnapshots((current) => {
          const sourceSessionId = message.sessionId as string
          const snapshot = current[sourceSessionId] || emptySnapshot(sourceSessionId)
          return { ...current, [sourceSessionId]: { ...snapshot, pendingAssignment: assignment, streaming: snapshot.streaming ? { ...snapshot.streaming, teamAssignment: assignment } : snapshot.streaming } }
        })
      }
      if (noteTeamPersistedEvent(mirroredEvents.current, message.sessionId, event)) {
        setSnapshots((current) => appendTeamEvent(current, message.sessionId as string, event, masterSessionId))
        return
      }
      setSnapshots((current) => applyEventToSnapshot(current, message.sessionId as string, event, masterSessionId))
    })
    const offDone = wsClient.on('session:done', (message) => {
      if (typeof message.sessionId !== 'string' || !sessionIds.includes(message.sessionId)) return
      const doneSessionId = message.sessionId as string
      const doneMessageId = typeof message.messageId === 'string' ? message.messageId : ''
      if (!doneMessageId) { void load(); return }
      setSnapshots((current) => finalizeSnapshot(current, doneSessionId, doneMessageId, masterSessionId, message.stopReason === 'error' ? 'failed' : message.stopReason === 'cancelled' ? 'cancelled' : 'completed', typeof message.error === 'string' ? message.error : undefined))
      const previousTimer = doneReloadTimers.current.get(doneSessionId)
      if (previousTimer) window.clearTimeout(previousTimer)
      const timer = window.setTimeout(() => {
        doneReloadTimers.current.delete(doneSessionId)
        void load()
      }, 180)
      doneReloadTimers.current.set(doneSessionId, timer)
    })
    const reloadTimers = doneReloadTimers.current
    return () => {
      offUpdate?.(); offProcess?.(); offEvent?.(); offDone?.(); wsClient.unsubscribe(sessionIds)
      reloadTimers.forEach((timer) => window.clearTimeout(timer))
      reloadTimers.clear()
    }
  }, [load, masterSessionId, sessionIds])

  const sendPrompt = useCallback(async (content: string, images: ImageAttachmentInfo[] = [], files: ConversationUploadedFile[] = []): Promise<void> => {
    if (!masterSessionId) throw new Error('团队暂无 Master 会话')
    const clientMessageId = `team-${Date.now()}`
    const fileContext = files.length ? `${content.trim()}\n\n[文件附件]\n${files.map((file) => `- 文件路径: ${file.path}\n- MIME: ${file.mimeType}\n- 原始文件名: ${file.name}`).join('\n')}` : content.trim()
    const optimistic = normalizeMessage({ id: `${masterSessionId}:${clientMessageId}`, session_id: masterSessionId, role: 'human', content: fileContext, thinking: null, tool_calls_json: null, decision_json: null, attachments_json: images.length ? JSON.stringify(images) : null, file_changes_json: null, timestamp: new Date().toISOString(), parsedAttachments: images, sender_name: '你', sender_role: 'human' })
    setSnapshots((current) => ({ ...current, [masterSessionId]: { ...(current[masterSessionId] || emptySnapshot(masterSessionId)), messages: [...(current[masterSessionId]?.messages || []), optimistic], running: true } }))
    setSending(true)
    try { await commandClient.execute({ commandId: clientMessageId, type: 'prompt', sessionId: masterSessionId, clientMessageId, content: fileContext, ...(images.length ? { images: images.filter((image): image is ImageAttachmentInfo & { data: string } => typeof image.data === 'string').map((image) => ({ data: image.data, mimeType: image.mimeType })) } : {}) }) }
    finally { setSending(false) }
  }, [masterSessionId])

  const aggregate = useMemo(() => aggregateSnapshots(snapshots, sessionIds, masterSessionId), [masterSessionId, sessionIds, snapshots])
  const loadOlderMessages = useCallback(async (): Promise<void> => {
    if (loadingOlder || !masterSessionId) return
    const oldest = aggregate.messages[0]
    const source = oldest ? sourceMap.current.get(oldest.id) : undefined
    if (!source || !aggregate.hasMore) return
    setLoadingOlder(true)
    try {
      const page = await queryClient.listSessionMessages({ sessionId: source.sourceSessionId, limit: 40, before: source.message.timestamp, includeToolCalls: true })
      const mapped = page.items.map((message) => normalizeMessage(mapTeamMessage(message, source.sourceSessionId, masterSessionId, source.message.sender_name || 'Agent', source.message.sender_role || 'member')))
      setSnapshots((current) => {
        const snapshot = current[source.sourceSessionId]
        if (!snapshot) return current
        const decorated = attachTeamAssignments([...mapped, ...snapshot.messages], snapshot.streaming)
        return { ...current, [source.sourceSessionId]: { ...snapshot, messages: decorated.messages, streaming: decorated.streaming, hasMore: page.hasMore } }
      })
    } finally { setLoadingOlder(false) }
  }, [aggregate, loadingOlder, masterSessionId])

  const loadMessageProcess = useCallback(async (messageId: string): Promise<void> => {
    const source = sourceMap.current.get(messageId)
    if (!source || processByMessageId[messageId]?.loading || processByMessageId[messageId]?.loaded) return
    setProcessByMessageId((current) => ({ ...current, [messageId]: { blocks: current[messageId]?.blocks || [], loading: true, loaded: false } }))
    try {
      const items = await wsClient.request({ type: 'sessions.messageProcess', sessionId: source.sourceSessionId, messageId: source.sourceMessageId }) as Parameters<typeof turnFromProcessItems>[1]
      const blocks = turnFromProcessItems(messageId, items).processBlocks
      setProcessByMessageId((current) => ({ ...current, [messageId]: { blocks, loading: false, loaded: true } }))
    } catch (cause) { setProcessByMessageId((current) => ({ ...current, [messageId]: { blocks: current[messageId]?.blocks || [], loading: false, loaded: false, error: cause instanceof Error ? cause.message : '执行过程加载失败' } })) }
  }, [processByMessageId])
  const loadFileChanges = useCallback(async (messageId: string): Promise<void> => {
    const source = sourceMap.current.get(messageId)
    if (!source || fileChanges[messageId]) return
    try { const detail = await wsClient.request({ type: 'sessions.messageFileChanges', sessionId: source.sourceSessionId, messageId: source.sourceMessageId }) as FileChangeDetailInfo; setFileChanges((current) => ({ ...current, [messageId]: detail })) }
    catch (cause) { setFileErrors((current) => ({ ...current, [messageId]: cause instanceof Error ? cause.message : '文件变更加载失败' })) }
  }, [fileChanges])
  const adapter = useMemo<ConversationAdapter>(() => createAdapter({ team, conversation, masterSessionId, aggregate, loading, error, sending, loadingOlder, processByMessageId, fileChanges, fileErrors, sendPrompt, loadOlderMessages, loadMessageProcess, loadFileChanges, reload: load, resolveSource: (id) => sourceMap.current.get(id) }), [aggregate, conversation, error, fileChanges, fileErrors, load, loadFileChanges, loadMessageProcess, loadOlderMessages, loading, loadingOlder, masterSessionId, processByMessageId, sendPrompt, sending, team])
  return <ConversationPane adapter={adapter} />
}

function createAdapter(input: { team: TeamData; conversation: Conversation | null; masterSessionId: string | null; aggregate: ReturnType<typeof aggregateSnapshots>; loading: boolean; error: string | null; sending: boolean; loadingOlder: boolean; processByMessageId: Record<string, ConversationProcessState>; fileChanges: Record<string, FileChangeDetailInfo>; fileErrors: Record<string, string>; loadMessageProcess: (id: string) => Promise<void>; loadFileChanges: (id: string) => Promise<void>; sendPrompt: ConversationAdapter['sendPrompt']; loadOlderMessages: () => Promise<void>; reload: () => Promise<void>; resolveSource: (id: string) => SourceMessage | undefined }): ConversationAdapter {
  return { sessionId: input.masterSessionId, projectId: input.team.project_id, agentName: input.conversation ? `${input.team.name} · Master` : input.team.name, agentRuntime: 'team', sessionTitle: input.conversation?.title ?? null, messages: input.aggregate.messages, events: input.aggregate.events, streamingMessage: input.aggregate.streaming[0] || null, streamingMessages: input.aggregate.streaming, loading: input.loading, error: input.error, running: input.aggregate.running, sending: input.sending, connected: true, hasMoreMessages: input.aggregate.hasMore, loadingOlderMessages: input.loadingOlder, pendingPermissions: input.aggregate.permissions, pendingElicitations: input.aggregate.elicitations, interactionError: null, capabilities: input.aggregate.capabilities, usage: input.aggregate.usage, processByMessageId: input.processByMessageId, fileChangeDetailsByMessageId: input.fileChanges, fileChangeLoadingByKey: {}, fileChangeErrorByKey: Object.fromEntries(Object.entries(input.fileErrors).map(([id, message]) => [`file:${id}`, message])), processItemLoadingByKey: {}, processItemErrorByKey: {}, sendPrompt: input.sendPrompt, cancel: async () => { if (input.masterSessionId) await commandClient.execute({ commandId: `team-cancel-${input.masterSessionId}-${Date.now()}`, type: 'session.cancel', sessionId: input.masterSessionId }) }, loadOlderMessages: input.loadOlderMessages, reload: input.reload, loadMessageProcess: input.loadMessageProcess, loadFileChanges: input.loadFileChanges, loadProcessItemDetail: async () => undefined, respondPermission: async (requestId, optionId, cancelled) => { if (input.masterSessionId) await commandClient.execute({ commandId: `team-permission-${requestId}`, type: 'permission.respond', sessionId: input.masterSessionId, permissionRequestId: requestId, optionId, cancelled }) }, respondElicitation: async (requestId, action, content) => { if (input.masterSessionId) await commandClient.execute({ commandId: `team-elicitation-${requestId}`, type: 'elicitation.respond', sessionId: input.masterSessionId, elicitationRequestId: requestId, action, content }) }, setModel: async (id) => { if (input.masterSessionId) await wsClient.request({ type: 'session.setModel', sessionId: input.masterSessionId, modelId: id }) }, setMode: async (id) => { if (input.masterSessionId) await wsClient.request({ type: 'session.setMode', sessionId: input.masterSessionId, modeId: id }) }, setConfig: async (id, value) => { if (input.masterSessionId) await wsClient.request({ type: 'session.setConfig', sessionId: input.masterSessionId, configId: id, value }) } }
}

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
export function mergeLoadedSnapshots(current: Record<string, Snapshot>, loaded: Record<string, Snapshot>): Record<string, Snapshot> {
  const merged: Record<string, Snapshot> = { ...current }
  Object.entries(loaded).forEach(([sessionId, next]) => {
    const previous = current[sessionId]
    if (!previous) { merged[sessionId] = next; return }
    const messages = new Map(previous.messages.map((message) => [message.id, message]))
    next.messages.forEach((message) => {
      const existing = messages.get(message.id)
      messages.set(message.id, existing ? mergeMessage(existing, message) : message)
    })
    const staleStreaming = isStaleRunningTurn(previous, next.streaming, sessionId)
    const completedInHistory = hasCompletedTurn(next.messages, previous.streaming, sessionId)
    merged[sessionId] = {
      ...previous,
      ...next,
      messages: [...messages.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)),
      events: [...new Map([...previous.events, ...next.events].map((event) => [event.id, event])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.sequence - b.sequence),
      // A delayed history response can still expose the just-finished turn as
      // running. Never resurrect that turn after a local done event finalized it.
      streaming: staleStreaming || completedInHistory ? null : next.streaming || previous.streaming,
      running: staleStreaming || completedInHistory ? false : previous.running || next.running,
      hasMore: next.messages.length > 0 ? next.hasMore : previous.hasMore,
    }
  })
  return merged
}

export function finalizeSnapshot(current: Record<string, Snapshot>, sessionId: string, messageId: string, targetSessionId: string | null = sessionId, status = 'completed', error?: string): Record<string, Snapshot> {
  const snapshot = current[sessionId]
  if (!snapshot) return current
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
    timestamp: new Date().toISOString(),
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

function findTurnMessage(messages: MessageData[], sessionId: string, messageId: string): MessageData | undefined {
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

function mergeMessage(previous: MessageData, next: MessageData): MessageData {
  const nextHasContent = next.content.trim().length > 0
  const nextHasFinalAnswer = !!next.finalAnswer?.trim()
  const status = previous.status === 'completed' && next.status !== 'completed' ? 'completed' : next.status || previous.status
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

function isStaleRunningTurn(previous: Snapshot, loadedStreaming: StreamingMessage | null, sessionId: string): boolean {
  if (!loadedStreaming || previous.running) return false
  const rawId = loadedStreaming.id.startsWith(`${sessionId}:`) ? loadedStreaming.id.slice(sessionId.length + 1) : loadedStreaming.id
  return previous.messages.some((message) => {
    if (message.id !== `${sessionId}:${rawId}` && message.id !== rawId) return false
    return message.status === 'completed' || !!message.completed_at || !!message.finalAnswer || message.content.trim().length > 0
  })
}

function hasCompletedTurn(messages: MessageData[], streaming: StreamingMessage | null, sessionId: string): boolean {
  if (!streaming) return false
  const rawId = streaming.id.startsWith(`${sessionId}:`) ? streaming.id.slice(sessionId.length + 1) : streaming.id
  return messages.some((message) => {
    if (message.id !== `${sessionId}:${rawId}` && message.id !== rawId) return false
    return message.status === 'completed' || !!message.completed_at
  })
}
function toStreaming(message: MessageData, sessionId: string): StreamingMessage { const id = message.id.startsWith(`${sessionId}:`) ? message.id.slice(sessionId.length + 1) : message.id; return { ...createEmptyTurn(id), content: message.content, finalAnswer: message.finalAnswer || message.content, processBlocks: message.processBlocks || [], toolCalls: message.parsedToolCalls || [], senderName: message.sender_name || undefined, teamAssignment: message.teamAssignment, done: false } }
function remapStreaming(streaming: StreamingMessage, sessionId: string, senderName?: string): StreamingMessage { const id = streaming.id.startsWith(`${sessionId}:`) ? streaming.id : `${sessionId}:${streaming.id}`; return { ...streaming, id, senderName: senderName || streaming.senderName } }
function normalizeCapabilities(value: unknown): SessionCapabilities { if (!value || typeof value !== 'object') return { ...defaultCaps }; const input = value as Partial<SessionCapabilities>; return mergeCapabilities({ ...defaultCaps }, { ...defaultCaps, models: Array.isArray(input.models) ? input.models : [], currentModelId: typeof input.currentModelId === 'string' ? input.currentModelId : null, modes: Array.isArray(input.modes) ? input.modes : [], currentModeId: typeof input.currentModeId === 'string' ? input.currentModeId : null, supportsImages: input.supportsImages === true, configOptions: Array.isArray(input.configOptions) ? input.configOptions : [], commands: Array.isArray(input.commands) ? input.commands : [] }) }
function remapEvent(event: SessionEventData, sourceSessionId: string, targetSessionId: string): SessionEventData { const parsed = (() => { try { return JSON.parse(event.payload_json) as Record<string, unknown> } catch { return null } })(); const payload = parsed || {}; if (typeof payload.messageId === 'string') payload.messageId = `${sourceSessionId}:${payload.messageId}`; return { ...event, id: `${sourceSessionId}:${event.id}`, session_id: targetSessionId, message_id: event.message_id ? `${sourceSessionId}:${event.message_id}` : event.message_id, payload_json: JSON.stringify(payload) } }
function reduceRecovery(events: SessionEventData[]): ReducedSessionEvents { return events.reduce<ReducedSessionEvents>((state, event) => applySessionEvent(state, event), { streamingMessage: null, usage: null, turnUsage: null, capabilities: { ...defaultCaps }, plan: [], pendingPermissions: [], pendingElicitations: [] }) }
function teamMirrorType(data: Record<string, unknown>): string | null { if (typeof data.eventType === 'string' && ['message.chunk', 'thinking.chunk', 'tool.call', 'tool.update'].includes(data.eventType)) return data.eventType; if (data.contentDelta || data.content) return 'message.chunk'; if (data.thinking) return 'thinking.chunk'; if (data.toolCall) return 'tool.call'; if (data.toolCallUpdate) return 'tool.update'; return null }
function teamMirrorKey(sessionId: string, type: string, data: Record<string, unknown>): string | null { const messageId = typeof data.messageId === 'string' ? data.messageId : ''; if (type === 'message.chunk') return `${sessionId}|${type}|${messageId}|${String(data.contentDelta ?? data.content ?? '')}`; if (type === 'thinking.chunk') return `${sessionId}|${type}|${messageId}|${String(data.thinking ?? '')}`; const tool = (type === 'tool.call' ? data.toolCall : data.toolCallUpdate) as { id?: unknown; status?: unknown; progressDelta?: unknown; terminalOutputDelta?: unknown } | null; return tool && typeof tool.id === 'string' ? `${sessionId}|${type}|${messageId}|${tool.id}|${String(tool.status ?? '')}|${String(tool.progressDelta ?? '')}|${String(tool.terminalOutputDelta ?? '')}` : null }
function noteTeamRealtimeUpdate(records: Map<string, { expiresAt: number; updateCount: number; eventCount: number }>, sessionId: string, data: Record<string, unknown>): void { const type = teamMirrorType(data); const key = type ? teamMirrorKey(sessionId, type, data) : null; if (!key) return; records.set(key, { expiresAt: Date.now() + 30000, updateCount: 1, eventCount: 0 }) }
function noteTeamPersistedEvent(records: Map<string, { expiresAt: number; updateCount: number; eventCount: number }>, sessionId: string, event: SessionEventData): boolean { for (const [key, value] of records) if (value.expiresAt <= Date.now()) records.delete(key); const payload = (() => { try { return JSON.parse(event.payload_json) as Record<string, unknown> } catch { return null } })(); if (!payload) return false; const data = event.type === 'message.chunk' ? { messageId: payload.messageId, contentDelta: payload.contentDelta, content: payload.content } : event.type === 'thinking.chunk' ? { messageId: payload.messageId, thinking: payload.thinking } : event.type === 'tool.call' ? { messageId: payload.messageId, toolCall: payload.toolCall } : { messageId: payload.messageId, toolCallUpdate: payload.toolCall }; const key = teamMirrorKey(sessionId, event.type, data); if (!key) return false; const record = records.get(key); if (!record || record.updateCount < 1) return false; records.delete(key); return true }
function appendTeamEvent(current: Record<string, Snapshot>, sessionId: string, event: SessionEventData, targetSessionId: string | null): Record<string, Snapshot> { const snapshot = current[sessionId] || emptySnapshot(sessionId); const displayEventId = `${sessionId}:${event.id}`; if (snapshot.events.some((item) => item.id === displayEventId)) return current; return { ...current, [sessionId]: { ...snapshot, events: [...snapshot.events, remapEvent(event, sessionId, targetSessionId || sessionId)] } } }
export function updateStreaming(current: Record<string, Snapshot>, sessionId: string, data: Record<string, unknown>): Record<string, Snapshot> { const snapshot = current[sessionId] || emptySnapshot(sessionId); const incomingId = typeof data.messageId === 'string' ? data.messageId : snapshot.streaming?.id || `team-${sessionId}`; let turn = snapshot.streaming && !snapshot.streaming.done && snapshot.streaming.id === incomingId ? snapshot.streaming : createEmptyTurn(incomingId); turn = { ...turn, senderName: snapshot.senderName, teamAssignment: snapshot.pendingAssignment || turn.teamAssignment }; if (typeof data.contentDelta === 'string') turn = applyTurnEntry(turn, { kind: 'reply', text: data.contentDelta }); if (typeof data.thinking === 'string') turn = applyTurnEntry(turn, { kind: 'thinking', text: data.thinking }); if (data.toolCall && typeof data.toolCall === 'object') turn = applyTurnEntry(turn, { kind: 'toolCall', toolCall: data.toolCall as ToolCallInfo }); if (data.toolCallUpdate && typeof data.toolCallUpdate === 'object') turn = applyTurnEntry(turn, { kind: 'toolUpdate', toolCall: data.toolCallUpdate as ToolCallInfo }); return { ...current, [sessionId]: { ...snapshot, streaming: turn, running: true } } }
  export function applyEventToSnapshot(current: Record<string, Snapshot>, sessionId: string, event: SessionEventData, targetSessionId: string | null): Record<string, Snapshot> { const snapshot = current[sessionId] || emptySnapshot(sessionId); const displayEventId = `${sessionId}:${event.id}`; if (snapshot.events.some((item) => item.id === displayEventId)) return current; const reduced = applySessionEvent({ streamingMessage: snapshot.streaming, usage: snapshot.usage, turnUsage: null, capabilities: snapshot.capabilities, plan: [], pendingPermissions: snapshot.permissions, pendingElicitations: snapshot.elicitations }, event); const events = [...snapshot.events, remapEvent(event, sessionId, targetSessionId || sessionId)]; if (event.type === 'message.done' && snapshot.streaming) { const payload = parseEventPayload(event); const turnUsage = payload?.turnUsage && typeof payload.turnUsage === 'object' && !Array.isArray(payload.turnUsage) ? payload.turnUsage as StreamingMessage['turnStats'] : snapshot.streaming.turnStats; const messageId = typeof payload?.messageId === 'string' ? payload.messageId : event.message_id || snapshot.streaming.id; const status = payload?.stopReason === 'error' ? 'failed' : payload?.stopReason === 'cancelled' ? 'cancelled' : 'completed'; const error = typeof payload?.error === 'string' ? payload.error : undefined; const completedState = { ...current, [sessionId]: { ...snapshot, events, streaming: { ...snapshot.streaming, turnStats: turnUsage }, usage: reduced.usage, permissions: reduced.pendingPermissions, elicitations: reduced.pendingElicitations, running: false } }; return finalizeSnapshot(completedState, sessionId, messageId, targetSessionId, status, error) } return { ...current, [sessionId]: { ...snapshot, events, streaming: reduced.streamingMessage ? { ...reduced.streamingMessage, senderName: snapshot.senderName, teamAssignment: snapshot.pendingAssignment || reduced.streamingMessage.teamAssignment } : null, usage: reduced.usage, permissions: reduced.pendingPermissions, elicitations: reduced.pendingElicitations, running: !!reduced.streamingMessage } } }

function parseEventPayload(event: SessionEventData): Record<string, unknown> | null { try { const payload = JSON.parse(event.payload_json) as unknown; return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null } catch { return null } }
function mergeProcessItem(current: Record<string, Snapshot>, sessionId: string, item: TurnProcessItemInfo, block: TurnProcessBlock): Record<string, Snapshot> { const snapshot = current[sessionId] || emptySnapshot(sessionId); const currentTurn = snapshot.streaming?.id === item.message_id ? snapshot.streaming : createEmptyTurn(item.message_id); const processBlocks = [...currentTurn.processBlocks.filter((entry) => entry.id !== block.id), block]; return { ...current, [sessionId]: { ...snapshot, streaming: { ...currentTurn, processBlocks, senderName: snapshot.senderName, teamAssignment: snapshot.pendingAssignment || currentTurn.teamAssignment }, running: true } } }
