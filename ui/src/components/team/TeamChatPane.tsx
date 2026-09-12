/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ConversationPane } from '../chat/ConversationPane'
import type { ConversationAdapter, ConversationUploadedFile, ConversationProcessState } from '../chat/conversation-types'
import type { FileChangeDetailInfo, FilesPresentationInfo, ImageAttachmentInfo, PreviewPresentationInfo, SessionEventData, TurnProcessItemInfo } from '../../stores/session-events'
import type { OpenChatResource } from '../../services/chat-resource-links'
import { normalizeMessage } from '../../stores/session-events'
import { turnFromProcessItems } from '../../stores/turn-blocks'
import { commandClient } from '../../services/command-client'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'
import { loadOlderTeamPages, mergeOlderTeamPages } from './team-chat-history'
import { loadTeamSession, loadTeamMessagePage } from './team-chat-loader'
import { mergeTeamMessageRefresh, runTeamLoads, TeamRecoveryGate } from './team-chat-refresh'
import { teamCacheKey, teamChatCache, shareTeamRequest, invalidateTeamRequest, newTeamRequestScope, type SourceMessage, type TeamChatMember as Member } from './team-view-cache'
import { useTeamRead } from './use-team-read'
import { beginTeamPrompt, rejectTeamPrompt } from './team-chat-pending'
import { createTeamChatAdapter } from './team-chat-adapter'

import { aggregateSnapshots, emptySnapshot, mergeLoadedSnapshots, finalizeSnapshot, applyEventToSnapshot, mergeProcessItem, normalizeCapabilities, type Snapshot } from './team-chat-state'
export { aggregateSnapshots, emptySnapshot, mergeLoadedSnapshots, finalizeSnapshot, applyEventToSnapshot, updateStreaming, hasLiveStreaming, rebuildStreamingFromEvents, TEAM_STREAM_REBUILD_EVENT_LIMIT, type Snapshot } from './team-chat-state'

interface Conversation { id: string; team_id: string; master_session_id: string; title: string }
interface Props {
  cacheScope?: string
  renderSurface?: (adapter: ConversationAdapter) => ReactElement
  team: TeamData
  conversation: Conversation | null
  masterSessionId: string | null
  onOpenPreview?: (preview: PreviewPresentationInfo) => void
  onOpenFiles?: (presentation: FilesPresentationInfo) => void
  onOpenResource?: OpenChatResource
}

export function TeamChatPane(props: Props): ReactElement {
  return <TeamConversationPane key={(props.cacheScope || '') + teamCacheKey(props.team.project_id, props.team.id, props.conversation?.id || props.masterSessionId || 'empty')} {...props} />
}

function TeamConversationPane({ team, conversation, masterSessionId, onOpenPreview, onOpenFiles, onOpenResource, renderSurface, cacheScope }: Props): ReactElement {
  const cacheKey = (cacheScope || '') + teamCacheKey(team.project_id, team.id, conversation?.id)
  const [cached] = useState(() => teamChatCache.get(cacheKey))
  const [requestScope] = useState(newTeamRequestScope)
  const [members, setMembers] = useState<Member[]>(cached?.members || [])
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>(cached?.snapshots || {})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const olderRequestRef = useRef(false)
  const [processByMessageId, setProcessByMessageId] = useState<Record<string, ConversationProcessState>>({})
  const [fileChanges, setFileChanges] = useState<Record<string, FileChangeDetailInfo>>({})
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({})
  const [processItemLoadingByKey, setProcessItemLoadingByKey] = useState<Record<string, boolean>>({})
  const [processItemErrorByKey, setProcessItemErrorByKey] = useState<Record<string, string>>({})
  const sourceMap = useRef(new Map<string, SourceMessage>(cached?.sources))
  const subscribedSessions = useRef(new Set<string>())
  const doneReloadTimers = useRef(new Map<string, number>())
  const memberLabels = useRef(new Map<string, { name: string; role: string }>())
  const recoveryGate = useRef(new TeamRecoveryGate())
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
  const markUnread = useTeamRead(conversation?.id, visibleSnapshots)

  const load = useCallback((): Promise<boolean> => shareTeamRequest(`load:${cacheKey}:${requestScope}`, async () => {
    if (!conversation) { setMembers([]); setSnapshots({}); sourceMap.current.clear(); return false }
    const requestGeneration = ++generation.current
    const recoveryVersion = recoveryGate.current.version
    setLoading(!hasContent.current); setError(null)
    try {
      const detail = await shareTeamRequest(`history:${cacheKey}:${requestScope}`, () => wsClient.request({ type: 'team.conversation.history', conversationId: conversation.id })) as { members?: Member[] }
      if (requestGeneration !== generation.current) return false
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
      memberLabels.current = labels
      const results = await runTeamLoads(ids, async (sessionId) => {
        if (requestGeneration !== generation.current) return
        const label = labels.get(sessionId)
        const loaded = await loadTeamSession(`${cacheKey}:${requestScope}`, sessionId, conversation.master_session_id, label?.name || 'Agent', label?.role || 'member')
        if (requestGeneration !== generation.current) return
        sourceMap.current = new Map([...sourceMap.current, ...loaded.sources])
        setSnapshots(current => mergeLoadedSnapshots(current, { [sessionId]: { ...loaded.snapshot, capabilities: current[sessionId]?.capabilities || loaded.snapshot.capabilities } }))
        setLoading(false)
      })
      if (requestGeneration !== generation.current) return false
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      recoveryGate.current.complete(recoveryVersion)
      return true
    } catch (cause) { if (requestGeneration === generation.current) setError(`消息同步失败：${cause instanceof Error ? cause.message : '请重试'}`); return false }
    finally { if (requestGeneration === generation.current) setLoading(false) }
  }), [conversation, cacheKey, requestScope])

  const refreshMember = useCallback(async (sessionId: string): Promise<void> => {
    if (!masterSessionId || !subscribedSessions.current.has(sessionId)) return
    const requestGeneration = generation.current
    const label = memberLabels.current.get(sessionId)
    try {
      const page = await loadTeamMessagePage(`${cacheKey}:${requestScope}:done`, sessionId, masterSessionId, label?.name || 'Agent', label?.role || 'member')
      if (requestGeneration !== generation.current || !subscribedSessions.current.has(sessionId)) return
      sourceMap.current = new Map([...sourceMap.current, ...page.sources])
      setSnapshots(current => mergeTeamMessageRefresh(current, sessionId, page.snapshot))
    } catch (cause) { if (requestGeneration === generation.current) setError(`消息同步失败：${cause instanceof Error ? cause.message : '请重试'}`) }
  }, [cacheKey, requestScope, masterSessionId])

  useEffect(() => {
    if (!masterSessionId) return
    let cancelled = false
    void shareTeamRequest(`models:${cacheKey}:${masterSessionId}`, () => wsClient.request({ type: 'session.getModels', sessionId: masterSessionId })).then(caps => {
      if (!cancelled) setSnapshots(current => ({ ...current, [masterSessionId]: { ...(current[masterSessionId] || emptySnapshot(masterSessionId)), capabilities: normalizeCapabilities(caps) } }))
    }).catch(() => { /* History remains usable when Runtime discovery fails. */ })
    return () => { cancelled = true }
  }, [cacheKey, masterSessionId])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => { window.clearTimeout(timer); invalidateLoad() } }, [load, invalidateLoad])
  const mobileSurface = !!renderSurface
  useEffect(() => {
    if (!mobileSurface) return
    const off = wsClient.on('resync_required', () => {
      recoveryGate.current.request()
      // Resume before querying: incoming events are retained in each snapshot's
      // replay buffer, then merged after its persisted recovery boundary.
      wsClient.acknowledgeResync()
      void load().then(loaded => { if (loaded && recoveryGate.current.pending) void load() })
    })
    const visible = (): void => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { off(); document.removeEventListener('visibilitychange', visible) }
  }, [load, mobileSurface])
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
      if (!doneMessageId) { void refreshMember(doneSessionId); return }
      setSnapshots((current) => finalizeSnapshot(current, doneSessionId, doneMessageId, masterSessionId, message.stopReason === 'error' ? 'failed' : message.stopReason === 'cancelled' ? 'cancelled' : 'completed', typeof message.error === 'string' ? message.error : undefined))
      const previousTimer = doneReloadTimers.current.get(doneSessionId)
      if (previousTimer) window.clearTimeout(previousTimer)
      const timer = window.setTimeout(() => {
        doneReloadTimers.current.delete(doneSessionId)
        void refreshMember(doneSessionId)
      }, 180)
      doneReloadTimers.current.set(doneSessionId, timer)
    })
    const reloadTimers = doneReloadTimers.current
    return () => {
      offTeam(); offReconnect(); offProcess?.(); offEvent?.(); offDone?.(); wsClient.unsubscribe([...subscriptions]); subscriptions.clear()
      reloadTimers.forEach((timer) => window.clearTimeout(timer))
      reloadTimers.clear()
    }
  }, [load, refreshMember, masterSessionId, cached, team.id, cacheKey, requestScope])

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
    if (olderRequestRef.current || !masterSessionId || !aggregate.hasMore) return
    olderRequestRef.current = true
    const requestGeneration = generation.current
    setLoadingOlder(true)
    try {
      const pages = await loadOlderTeamPages(snapshots, sessionIds, masterSessionId)
      if (generation.current !== requestGeneration) return
      sourceMap.current = new Map([...sourceMap.current, ...pages.flatMap(page => page.sources)])
      setSnapshots(current => mergeOlderTeamPages(current, pages))
    } finally { olderRequestRef.current = false; setLoadingOlder(false) }
  }, [aggregate.hasMore, snapshots, sessionIds, masterSessionId])

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
  const loadProcessItemDetail = useCallback(async (messageId: string, itemId: string): Promise<void> => {
    const source = sourceMap.current.get(messageId)
    const key = `${messageId}:${itemId}`
    if (!source || processItemLoadingByKey[key]) return
    setProcessItemLoadingByKey((current) => ({ ...current, [key]: true }))
    setProcessItemErrorByKey((current) => ({ ...current, [key]: '' }))
    try {
      const item = await wsClient.request({
        type: 'sessions.processItemDetail',
        sessionId: source.sourceSessionId,
        messageId: source.sourceMessageId,
        itemId,
      }) as TurnProcessItemInfo
      const detailBlock = turnFromProcessItems(messageId, [item]).processBlocks[0]
      if (!detailBlock) return
      setProcessByMessageId((current) => {
        const state = current[messageId]
        if (!state) return current
        return { ...current, [messageId]: { ...state, blocks: state.blocks.map((block) => block.id === itemId ? detailBlock : block) } }
      })
    } catch (cause) {
      setProcessItemErrorByKey((current) => ({ ...current, [key]: cause instanceof Error ? cause.message : '执行过程详情加载失败' }))
    } finally {
      setProcessItemLoadingByKey((current) => { const next = { ...current }; delete next[key]; return next })
    }
  }, [processItemLoadingByKey])
  const adapter = useMemo<ConversationAdapter>(() => createTeamChatAdapter({ snapshots, team, conversation, masterSessionId, aggregate, loading, error, sending, loadingOlder, processByMessageId, fileChanges, fileErrors, processItemLoadingByKey, processItemErrorByKey, sendPrompt, loadOlderMessages, loadMessageProcess, loadFileChanges, loadProcessItemDetail, reload: load, markUnread, senderAgentIds: Object.fromEntries(members.map(member => [member.session_id, member.agent_id])) }), [snapshots, aggregate, conversation, error, fileChanges, fileErrors, load, loadFileChanges, loadMessageProcess, loadOlderMessages, loadProcessItemDetail, loading, loadingOlder, masterSessionId, processByMessageId, processItemErrorByKey, processItemLoadingByKey, sendPrompt, sending, team, markUnread, members])
  return renderSurface ? renderSurface(adapter) : <ConversationPane compactTeam adapter={adapter} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} onOpenResource={onOpenResource} />
}
