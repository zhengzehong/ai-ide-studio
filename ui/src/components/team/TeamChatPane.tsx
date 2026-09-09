import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConversationPane } from '../chat/ConversationPane'
import type { ConversationAdapter, ConversationUploadedFile, ConversationProcessState } from '../chat/conversation-types'
import type { FileChangeDetailInfo, ImageAttachmentInfo, MessageData, PermissionRequestInfo, ElicitationRequestInfo, SessionCapabilities, SessionEventData, StreamingMessage, ToolCallInfo, UsageInfo, ReducedSessionEvents } from '../../stores/session-events'
import { applySessionEvent, defaultCaps, mergeCapabilities, normalizeMessage } from '../../stores/session-events'
import { applyTurnEntry, createEmptyTurn, turnFromProcessItems } from '../../stores/turn-blocks'
import { queryClient } from '../../services/query-client'
import { commandClient } from '../../services/command-client'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'

interface Conversation { id: string; team_id: string; master_session_id: string; title: string }
interface Member { id: string; agent_id: string; session_id: string; name: string; role: string }
interface Props { team: TeamData; conversation: Conversation | null; masterSessionId: string | null }
interface SourceMessage { message: MessageData; sourceSessionId: string; sourceMessageId: string }
interface Snapshot { sessionId: string; senderName?: string; messages: MessageData[]; events: SessionEventData[]; streaming: StreamingMessage | null; permissions: PermissionRequestInfo[]; elicitations: ElicitationRequestInfo[]; capabilities: SessionCapabilities; usage: UsageInfo | null; hasMore: boolean; running: boolean }

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
  const generation = useRef(0)
  const sessionIds = useMemo(() => [masterSessionId, ...members.map((member) => member.session_id)].filter((id): id is string => !!id), [masterSessionId, members])

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
          const displayId = `${sessionId}:${message.id}`
          const mappedMessage = normalizeMessage({ ...message, id: displayId, session_id: conversation.master_session_id, sender_name: label?.name || 'Agent', sender_role: label?.role || 'member' })
          nextSource.set(displayId, { message: mappedMessage, sourceSessionId: sessionId, sourceMessageId: message.id })
          return mappedMessage
        })
        const reduced = recovery.events.length ? reduceRecovery(recovery.events) : null
        const active = mapped.filter((message) => message.role === 'agent' && message.status === 'running').at(-1)
        nextSnapshots[sessionId] = { sessionId, senderName: label?.name || 'Agent', messages: mapped, events: recovery.events.map((event) => remapEvent(event, sessionId, conversation.master_session_id)), streaming: reduced?.streamingMessage ? remapStreaming(reduced.streamingMessage, sessionId, label?.name) : active ? toStreaming(active) : null, permissions: reduced?.pendingPermissions || [], elicitations: reduced?.pendingElicitations || [], capabilities: normalizeCapabilities(caps), usage: reduced?.usage || null, hasMore: page.hasMore, running: !!active || !!reduced?.streamingMessage }
      }))
      if (requestGeneration !== generation.current) return
      sourceMap.current = nextSource; setMembers(nextMembers); setSnapshots(nextSnapshots)
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
      if (data.contentDelta || data.thinking || data.toolCall || data.toolCallUpdate) setSnapshots((current) => updateStreaming(current, message.sessionId as string, data))
    })
    const offEvent = wsClient.on('session:event', (message) => { if (typeof message.sessionId === 'string' && sessionIds.includes(message.sessionId)) setSnapshots((current) => applyEventToSnapshot(current, message.sessionId as string, message.event as SessionEventData, masterSessionId)) })
    const offDone = wsClient.on('session:done', (message) => { if (typeof message.sessionId === 'string' && sessionIds.includes(message.sessionId)) void load() })
    return () => { offUpdate?.(); offEvent?.(); offDone?.() }
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
      const mapped = page.items.map((message) => normalizeMessage({ ...message, id: `${source.sourceSessionId}:${message.id}`, session_id: masterSessionId, sender_name: source.message.sender_name, sender_role: source.message.sender_role }))
      setSnapshots((current) => ({ ...current, [source.sourceSessionId]: { ...current[source.sourceSessionId], messages: [...mapped, ...(current[source.sourceSessionId]?.messages || [])], hasMore: page.hasMore } }))
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

function aggregateSnapshots(snapshots: Record<string, Snapshot>, ids: string[], masterSessionId: string | null) {
  const messages = ids.flatMap((id) => snapshots[id]?.messages || []).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
  const events = ids.flatMap((id) => snapshots[id]?.events || []).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.sequence - b.sequence)
  const streaming = ids.map((id) => snapshots[id]?.streaming).filter((item): item is StreamingMessage => !!item && !item.done)
  const capabilities = masterSessionId ? snapshots[masterSessionId]?.capabilities || { ...defaultCaps } : { ...defaultCaps }
  return { messages, events, streaming, capabilities, usage: masterSessionId ? snapshots[masterSessionId]?.usage || null : null, permissions: ids.flatMap((id) => snapshots[id]?.permissions || []), elicitations: ids.flatMap((id) => snapshots[id]?.elicitations || []), running: ids.some((id) => snapshots[id]?.running), hasMore: ids.some((id) => snapshots[id]?.hasMore) }
}
function emptySnapshot(sessionId: string): Snapshot { return { sessionId, messages: [], events: [], streaming: null, permissions: [], elicitations: [], capabilities: { ...defaultCaps }, usage: null, hasMore: false, running: false } }
function toStreaming(message: MessageData): StreamingMessage { return { ...createEmptyTurn(message.id), content: message.content, finalAnswer: message.finalAnswer || message.content, processBlocks: message.processBlocks || [], toolCalls: message.parsedToolCalls || [], senderName: message.sender_name || undefined, done: false } }
function remapStreaming(streaming: StreamingMessage, sessionId: string, senderName?: string): StreamingMessage { return { ...streaming, id: `${sessionId}:${streaming.id}`, senderName } }
function normalizeCapabilities(value: unknown): SessionCapabilities { if (!value || typeof value !== 'object') return { ...defaultCaps }; const input = value as Partial<SessionCapabilities>; return mergeCapabilities({ ...defaultCaps }, { ...defaultCaps, models: Array.isArray(input.models) ? input.models : [], currentModelId: typeof input.currentModelId === 'string' ? input.currentModelId : null, modes: Array.isArray(input.modes) ? input.modes : [], currentModeId: typeof input.currentModeId === 'string' ? input.currentModeId : null, supportsImages: input.supportsImages === true, configOptions: Array.isArray(input.configOptions) ? input.configOptions : [], commands: Array.isArray(input.commands) ? input.commands : [] }) }
function remapEvent(event: SessionEventData, sourceSessionId: string, targetSessionId: string): SessionEventData { let payload: Record<string, unknown> = {}; try { payload = JSON.parse(event.payload_json) as Record<string, unknown> } catch { /* retain malformed event */ }; if (typeof payload.messageId === 'string') payload.messageId = `${sourceSessionId}:${payload.messageId}`; return { ...event, id: `${sourceSessionId}:${event.id}`, session_id: targetSessionId, message_id: event.message_id ? `${sourceSessionId}:${event.message_id}` : event.message_id, payload_json: JSON.stringify(payload) } }
function reduceRecovery(events: SessionEventData[]): ReducedSessionEvents { return events.reduce<ReducedSessionEvents>((state, event) => applySessionEvent(state, event), { streamingMessage: null, usage: null, turnUsage: null, capabilities: { ...defaultCaps }, plan: [], pendingPermissions: [], pendingElicitations: [] }) }
function updateStreaming(current: Record<string, Snapshot>, sessionId: string, data: Record<string, unknown>): Record<string, Snapshot> { const snapshot = current[sessionId] || emptySnapshot(sessionId); let turn = snapshot.streaming || createEmptyTurn(typeof data.messageId === 'string' ? `${sessionId}:${data.messageId}` : `team-${sessionId}`); turn = { ...turn, senderName: snapshot.senderName }; if (typeof data.contentDelta === 'string') turn = applyTurnEntry(turn, { kind: 'reply', text: data.contentDelta }); if (typeof data.thinking === 'string') turn = applyTurnEntry(turn, { kind: 'thinking', text: data.thinking }); if (data.toolCall && typeof data.toolCall === 'object') turn = applyTurnEntry(turn, { kind: 'toolCall', toolCall: data.toolCall as ToolCallInfo }); if (data.toolCallUpdate && typeof data.toolCallUpdate === 'object') turn = applyTurnEntry(turn, { kind: 'toolUpdate', toolCall: data.toolCallUpdate as ToolCallInfo }); return { ...current, [sessionId]: { ...snapshot, streaming: turn, running: true } } }
function applyEventToSnapshot(current: Record<string, Snapshot>, sessionId: string, event: SessionEventData, targetSessionId: string | null): Record<string, Snapshot> { const snapshot = current[sessionId] || emptySnapshot(sessionId); const reduced = applySessionEvent({ streamingMessage: snapshot.streaming, usage: snapshot.usage, turnUsage: null, capabilities: snapshot.capabilities, plan: [], pendingPermissions: snapshot.permissions, pendingElicitations: snapshot.elicitations }, event); return { ...current, [sessionId]: { ...snapshot, events: [...snapshot.events.filter((item) => item.id !== event.id), remapEvent(event, sessionId, targetSessionId || sessionId)], streaming: reduced.streamingMessage ? remapStreaming(reduced.streamingMessage, sessionId) : null, usage: reduced.usage, permissions: reduced.pendingPermissions, elicitations: reduced.pendingElicitations, running: !!reduced.streamingMessage } } }
