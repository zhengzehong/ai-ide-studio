/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ConversationPane } from '../chat/ConversationPane'
import type { ConversationAdapter, ConversationUploadedFile, ConversationProcessState } from '../chat/conversation-types'
import type { FileChangeDetailInfo, ImageAttachmentInfo, SessionEventData, TurnProcessItemInfo } from '../../stores/session-events'
import { normalizeMessage } from '../../stores/session-events'
import { turnFromProcessItems } from '../../stores/turn-blocks'
import { queryClient } from '../../services/query-client'
import { commandClient } from '../../services/command-client'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'
import { attachTeamAssignments, mapTeamMessage } from './team-chat-assignments'
import { loadTeamSession } from './team-chat-loader'
import { teamCacheKey, teamChatCache, shareTeamRequest, invalidateTeamRequest, newTeamRequestScope, type SourceMessage, type TeamChatMember as Member } from './team-view-cache'
import { useTeamRead } from './use-team-read'
import { beginTeamPrompt, rejectTeamPrompt } from './team-chat-pending'

import { aggregateSnapshots, emptySnapshot, mergeLoadedSnapshots, finalizeSnapshot, applyEventToSnapshot, mergeProcessItem, normalizeCapabilities, type Snapshot } from './team-chat-state'
export { aggregateSnapshots, emptySnapshot, mergeLoadedSnapshots, finalizeSnapshot, applyEventToSnapshot, updateStreaming, hasLiveStreaming, rebuildStreamingFromEvents, TEAM_STREAM_REBUILD_EVENT_LIMIT, type Snapshot } from './team-chat-state'

interface Conversation { id: string; team_id: string; master_session_id: string; title: string }
interface Props { team: TeamData; conversation: Conversation | null; masterSessionId: string | null }

export function TeamChatPane(props: Props): ReactElement {
  return <TeamConversationPane key={teamCacheKey(props.team.project_id, props.team.id, props.conversation?.id || props.masterSessionId || 'empty')} {...props} />
}

function TeamConversationPane({ team, conversation, masterSessionId }: Props): ReactElement {
  const cacheKey = teamCacheKey(team.project_id, team.id, conversation?.id)
  const [cached] = useState(() => teamChatCache.get(cacheKey))
  const [requestScope] = useState(newTeamRequestScope)
  const [members, setMembers] = useState<Member[]>(cached?.members || [])
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>(cached?.snapshots || {})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [processByMessageId, setProcessByMessageId] = useState<Record<string, ConversationProcessState>>({})
  const [fileChanges, setFileChanges] = useState<Record<string, FileChangeDetailInfo>>({})
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({})
  const sourceMap = useRef(new Map<string, SourceMessage>(cached?.sources))
  const subscribedSessions = useRef(new Set<string>())
  const doneReloadTimers = useRef(new Map<string, number>())
  const generation = useRef(0)
  const hasContent = useRef(!!cached)
  useEffect(() => {
    if (!conversation || !members.length || !Object.values(snapshots).some(snapshot => snapshot.messages.length || snapshot.streaming)) return
    hasContent.current = true
    teamChatCache.set(cacheKey, { members, snapshots, sources: new Map(sourceMap.current) })
  }, [cacheKey, conversation, members, snapshots])
  const invalidateLoad = useCallback((): void => { generation.current++ }, [])
  const sessionIds = useMemo(() => [...new Set([masterSessionId, ...members.map((member) => member.session_id)].filter((id): id is string => !!id))], [masterSessionId, members])
  const visibleSnapshots = useMemo(() => Object.fromEntries(sessionIds.flatMap(id => snapshots[id] ? [[id, snapshots[id]]] : [])), [sessionIds, snapshots])
  useTeamRead(conversation?.id, visibleSnapshots)

  const load = useCallback(async (): Promise<void> => {
    if (!conversation) { setMembers([]); setSnapshots({}); sourceMap.current.clear(); return }
    const requestGeneration = ++generation.current
    setLoading(!hasContent.current); setError(null)
    try {
      const detail = await shareTeamRequest(`history:${cacheKey}:${requestScope}`, () => wsClient.request({ type: 'team.conversation.history', conversationId: conversation.id })) as { members?: Member[] }
      if (requestGeneration !== generation.current) return
      const nextMembers = Array.isArray(detail.members) ? detail.members : []
      const ids = [...new Set([conversation.master_session_id, ...nextMembers.map((member) => member.session_id)].filter((id): id is string => !!id))]
      const removed = [...subscribedSessions.current].filter(id => !ids.includes(id))
      removed.forEach(id => subscribedSessions.current.delete(id))
      wsClient.unsubscribe(removed)
      const added = ids.filter(id => !subscribedSessions.current.has(id))
      added.forEach(id => subscribedSessions.current.add(id))
      wsClient.subscribe(added)
      setMembers(nextMembers)
      const labels = new Map<string, { name: string; role: string }>([[conversation.master_session_id, { name: 'Master', role: 'Master' }]])
      nextMembers.forEach((member) => labels.set(member.session_id, { name: member.name, role: member.role }))
      const results = await Promise.allSettled(ids.map(async (sessionId) => {
        const label = labels.get(sessionId)
        const loaded = await loadTeamSession(`${cacheKey}:${requestScope}`, sessionId, conversation.master_session_id, label?.name || 'Agent', label?.role || 'member')
        if (requestGeneration !== generation.current) return
        sourceMap.current = new Map([...sourceMap.current, ...loaded.sources])
        setSnapshots(current => mergeLoadedSnapshots(current, { [sessionId]: { ...loaded.snapshot, capabilities: current[sessionId]?.capabilities || loaded.snapshot.capabilities } }))
        setLoading(false)
      }))
      if (requestGeneration !== generation.current) return
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    } catch (cause) { if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : '团队消息加载失败') }
    finally { if (requestGeneration === generation.current) setLoading(false) }
  }, [conversation, cacheKey, requestScope])

  useEffect(() => {
    if (!masterSessionId) return
    let cancelled = false
    void shareTeamRequest(`models:${cacheKey}:${masterSessionId}`, () => wsClient.request({ type: 'session.getModels', sessionId: masterSessionId })).then(caps => {
      if (!cancelled) setSnapshots(current => ({ ...current, [masterSessionId]: { ...(current[masterSessionId] || emptySnapshot(masterSessionId)), capabilities: normalizeCapabilities(caps) } }))
    }).catch(() => { /* History remains usable when Runtime discovery fails. */ })
    return () => { cancelled = true }
  }, [cacheKey, masterSessionId])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => { window.clearTimeout(timer); invalidateLoad() } }, [load, invalidateLoad])
  useEffect(() => {
    const subscriptions = subscribedSessions.current
    const initialIds = [...new Set([masterSessionId, ...(cached?.members || []).map(member => member.session_id)].filter((id): id is string => !!id))]
    initialIds.forEach(id => subscriptions.add(id))
    wsClient.subscribe(initialIds)
    const offReconnect = wsClient.on('reconnected', () => { void load() })
    const offTeam = wsClient.on('team:update', message => {
      if (message.teamId !== team.id || !message.data || typeof message.data !== 'object' || (message.data as Record<string, unknown>).reason !== 'member.created') return
      invalidateTeamRequest(`history:${cacheKey}:${requestScope}`)
      void load()
    })
    const offProcess = wsClient.on('session:process_item', (message) => {
      if (typeof message.sessionId !== 'string' || !subscribedSessions.current.has(message.sessionId)) return
      const item = message.item as TurnProcessItemInfo
      const block = turnFromProcessItems(item.message_id, [item]).processBlocks[0]
      if (!block) return
      setSnapshots((current) => mergeProcessItem(current, message.sessionId as string, item, block))
    })
    const offEvent = wsClient.on('session:event', (message) => {
      if (typeof message.sessionId !== 'string' || !subscribedSessions.current.has(message.sessionId)) return
      const event = message.event as SessionEventData
      setSnapshots((current) => applyEventToSnapshot(current, message.sessionId as string, event, masterSessionId))
    })
    const offDone = wsClient.on('session:done', (message) => {
      if (typeof message.sessionId !== 'string' || !subscribedSessions.current.has(message.sessionId)) return
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
      offTeam(); offReconnect(); offProcess?.(); offEvent?.(); offDone?.(); wsClient.unsubscribe([...subscriptions]); subscriptions.clear()
      reloadTimers.forEach((timer) => window.clearTimeout(timer))
      reloadTimers.clear()
    }
  }, [load, masterSessionId, cached, team.id, cacheKey, requestScope])

  const sendPrompt = useCallback(async (content: string, images: ImageAttachmentInfo[] = [], files: ConversationUploadedFile[] = []): Promise<void> => {
    if (!masterSessionId) throw new Error('团队暂无 Master 会话')
    const clientMessageId = `team-${Date.now()}`
    const fileContext = files.length ? `${content.trim()}\n\n[文件附件]\n${files.map((file) => `- 文件路径: ${file.path}\n- MIME: ${file.mimeType}\n- 原始文件名: ${file.name}`).join('\n')}` : content.trim()
    const optimistic = normalizeMessage({ id: `${masterSessionId}:${clientMessageId}`, session_id: masterSessionId, role: 'human', content: fileContext, thinking: null, tool_calls_json: null, decision_json: null, attachments_json: images.length ? JSON.stringify(images) : null, file_changes_json: null, timestamp: new Date().toISOString(), parsedAttachments: images, sender_name: '你', sender_role: 'human' })
    setSnapshots((current) => ({ ...current, [masterSessionId]: beginTeamPrompt(current[masterSessionId] || emptySnapshot(masterSessionId), optimistic) }))
    setSending(true)
    try { await commandClient.execute({ commandId: clientMessageId, type: 'prompt', sessionId: masterSessionId, clientMessageId, content: fileContext, ...(images.length ? { images: images.filter((image): image is ImageAttachmentInfo & { data: string } => typeof image.data === 'string').map((image) => ({ data: image.data, mimeType: image.mimeType })) } : {}) }) }
    catch (cause) {
      setSnapshots(current => ({ ...current, [masterSessionId]: rejectTeamPrompt(current[masterSessionId] || emptySnapshot(masterSessionId), optimistic.id) }))
      throw cause
    }
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
