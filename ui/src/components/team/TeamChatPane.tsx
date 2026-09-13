/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import { ConversationComposer } from '../chat/ConversationComposer'
import { ConversationMessageList } from '../chat/ConversationMessageList'
import { InteractionPanel } from '../global-assistant/GlobalAssistantInteractions'
import '../chat/conversation-pane.css'
import type { ConversationAdapter, ConversationUploadedFile, ConversationProcessState } from '../chat/conversation-types'
import type { FileChangeDetailInfo, FilesPresentationInfo, ImageAttachmentInfo, PreviewPresentationInfo, SessionEventData, TurnProcessItemInfo } from '../../stores/session-events'
import type { OpenChatResource } from '../../services/chat-resource-links'
import { normalizeMessage } from '../../stores/session-events'
import { turnFromProcessItems } from '../../stores/turn-blocks'
import { commandClient } from '../../services/command-client'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'
import { useAgentStore } from '../../stores/agent.store'
import { useModelStore } from '../../stores/model.store'
import { loadOlderTeamPages, mergeOlderTeamPages } from './team-chat-history'
import { loadTeamSession, loadTeamMessagePage } from './team-chat-loader'
import { mergeTeamMessageRefresh, runTeamLoads, TeamRecoveryGate } from './team-chat-refresh'
import { teamCacheKey, teamChatCache, shareTeamRequest, invalidateTeamRequest, newTeamRequestScope, type SourceMessage, type TeamChatMember as Member } from './team-view-cache'
import { useTeamRead } from './use-team-read'
import { beginTeamPrompt, rejectTeamPrompt } from './team-chat-pending'
import { subscribeTeamRecovery } from './team-chat-recovery'
import { createTeamChatAdapter } from './team-chat-adapter'
import { useTeamActivity } from './team-activity-view'
import { deriveMemberStatus, TeamAgentDock, type TeamDockMember, type TeamMemberModelConfig } from './TeamAgentDock'
import { TeamAgentSettingsModal, TeamMemberRemoveConfirm } from './TeamAgentSettingsModal'

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
  // 已移除成员（服务端会话线下发）：仅保留其会话聚合与历史消息，不出现在 dock 成员行。
  const [removedMembers, setRemovedMembers] = useState<Member[]>([])
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
  // 被移除成员的会话在本面板生命周期内保留订阅与聚合：历史消息不丢，正在执行的回合不被打断。
  const retainedSessions = useRef(new Set<string>())
  const [location, setLocation] = useState<{ messageId: string; request: number }>()
  const locateRequestRef = useRef(0)
  const [settingsMemberId, setSettingsMemberId] = useState<string | null>(null)
  const [confirmMemberId, setConfirmMemberId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const hasContent = useRef(!!cached)
  useEffect(() => {
    if (!conversation || !members.length || !Object.values(snapshots).some(snapshot => snapshot.messages.length || snapshot.streaming)) return
    hasContent.current = true
    teamChatCache.set(cacheKey, { members, snapshots, sources: new Map(sourceMap.current) })
  }, [cacheKey, conversation, members, snapshots])
  const invalidateLoad = useCallback((): void => { generation.current++ }, [])
  const sessionIds = useMemo(
    () => [...new Set([masterSessionId, ...members.map((member) => member.session_id), ...removedMembers.map((member) => member.session_id), ...retainedSessions.current].filter((id): id is string => !!id))],
    [masterSessionId, members, removedMembers],
  )
  const visibleSnapshots = useMemo(() => Object.fromEntries(sessionIds.flatMap(id => snapshots[id] ? [[id, snapshots[id]]] : [])), [sessionIds, snapshots])
  const markUnread = useTeamRead(conversation?.id, visibleSnapshots)

  const load = useCallback((): Promise<boolean> => shareTeamRequest(`load:${cacheKey}:${requestScope}`, async () => {
    if (!conversation) { setMembers([]); setSnapshots({}); sourceMap.current.clear(); return false }
    const requestGeneration = ++generation.current
    const recoveryVersion = recoveryGate.current.version
    setLoading(!hasContent.current); setError(null)
    try {
      const detail = await shareTeamRequest(`history:${cacheKey}:${requestScope}`, () => wsClient.request({ type: 'team.conversation.history', conversationId: conversation.id })) as { members?: Member[]; removedMembers?: Member[] }
      if (requestGeneration !== generation.current) return false
      const nextMembers = Array.isArray(detail.members) ? detail.members : []
      const nextRemoved = Array.isArray(detail.removedMembers) ? detail.removedMembers : []
      const ids = [...new Set([conversation.master_session_id, ...nextMembers.map((member) => member.session_id), ...nextRemoved.map((member) => member.session_id), ...retainedSessions.current].filter((id): id is string => !!id))]
      const removed = [...subscribedSessions.current].filter(id => !ids.includes(id))
      removed.forEach(id => subscribedSessions.current.delete(id))
      wsClient.unsubscribe(removed)
      const added = ids.filter(id => !subscribedSessions.current.has(id))
      added.forEach(id => subscribedSessions.current.add(id))
      wsClient.subscribe(added)
      setMembers(nextMembers)
      const labels = new Map<string, { name: string; role: string }>([[conversation.master_session_id, { name: 'Master', role: 'Master' }]])
      nextMembers.forEach((member) => labels.set(member.session_id, { name: member.name, role: member.role }))
      // 被移除成员的格子仍在聚合里：用服务端保留的成员名署名，避免刷新后退化为 Agent。
      nextRemoved.forEach((member) => { if (member.session_id) labels.set(member.session_id, { name: member.name, role: member.role }) })
      // 被移除成员的格子仍在聚合里，保留其展示名，避免刷新后流式回复署名退化为 Agent。
      retainedSessions.current.forEach((id) => { const previous = memberLabels.current.get(id); if (previous && !labels.has(id)) labels.set(id, previous) })
      memberLabels.current = labels
      setRemovedMembers(nextRemoved)
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
  useEffect(() => subscribeTeamRecovery({ client: wsClient, document, sessionIds: subscribedSessions.current, gate: recoveryGate.current, load }), [load])
  useEffect(() => {
    const subscriptions = subscribedSessions.current
    const initialIds = [...new Set([masterSessionId, ...(cached?.members || []).map(member => member.session_id)].filter((id): id is string => !!id))]
    initialIds.forEach(id => subscriptions.add(id))
    wsClient.subscribe(initialIds)
    const offReconnect = wsClient.on('reconnected', () => { void load() })
    const offTeam = wsClient.on('team:update', message => {
      if (message.teamId !== team.id || !message.data || typeof message.data !== 'object') return
      const reason = (message.data as Record<string, unknown>).reason
      if (reason !== 'member.created' && reason !== 'member.removed' && reason !== 'member.updated') return
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
  const adapter = useMemo<ConversationAdapter>(() => createTeamChatAdapter({ snapshots, team, conversation, masterSessionId, aggregate, loading, error, sending, loadingOlder, processByMessageId, fileChanges, fileErrors, processItemLoadingByKey, processItemErrorByKey, sendPrompt, loadOlderMessages, loadMessageProcess, loadFileChanges, loadProcessItemDetail, reload: load, markUnread, senderAgentIds: Object.fromEntries([...members, ...removedMembers].map(member => [member.session_id, member.agent_id])) }), [snapshots, aggregate, conversation, error, fileChanges, fileErrors, load, loadFileChanges, loadMessageProcess, loadOlderMessages, loadProcessItemDetail, loading, loadingOlder, masterSessionId, processByMessageId, processItemErrorByKey, processItemLoadingByKey, sendPrompt, sending, team, markUnread, members, removedMembers])

  // —— 团队 Agent dock：成员/状态/生效模型 + 设置与移除 ——
  const dockMembers = members as TeamDockMember[]
  const statusBySessionId = useMemo(
    () => Object.fromEntries(sessionIds.map((id) => [id, deriveMemberStatus(snapshots[id])])) as Record<string, ReturnType<typeof deriveMemberStatus>>,
    [sessionIds, snapshots],
  )
  const activity = useTeamActivity(adapter, true)
  const modelProfiles = useModelStore((state) => state.profiles)
  const fetchModelProfiles = useModelStore((state) => state.fetchProfiles)
  const loadModelProfiles = useCallback(() => { void fetchModelProfiles() }, [fetchModelProfiles])
  const settingsMember = dockMembers.find((member) => member.id === settingsMemberId) || null
  const confirmMember = dockMembers.find((member) => member.id === confirmMemberId) || null
  const masterEffective = dockMembers.find((member) => member.role === 'leader')?.modelConfig?.effective || null

  const locateMember = useCallback((member: TeamDockMember): void => {
    const latest = [...(snapshots[member.session_id]?.messages || [])].reverse().find((message) => message.role === 'agent')
    if (!latest) return
    locateRequestRef.current += 1
    setLocation({ messageId: latest.id, request: locateRequestRef.current })
  }, [snapshots])

  // dock 成员行中断：与 team-chat-adapter 的 leader cancel 同构（session.cancel 通用 RPC），stopReason='cancelled' 由平台既有语义落「已取消」。
  const cancelMemberTurn = useCallback((member: TeamDockMember): Promise<unknown> =>
    commandClient.execute({ commandId: `team-cancel-${member.session_id}-${Date.now()}`, type: 'session.cancel', sessionId: member.session_id }), [])

  // 保存回调不关弹窗：由弹窗在两条保存全部成功后统一 onClose（P2：避免一成一败时关弹窗吞错误）。
  const saveMemberConfig = useCallback(async (member: TeamDockMember, input: { modelProfileMode: 'inherit' | 'fixed' | 'system'; modelProfileId: string | null }): Promise<void> => {
    const config = await wsClient.request({ type: 'team.member.config.update', memberId: member.id, ...input }) as TeamMemberModelConfig
    setMembers((current) => current.map((item) => item.id === member.id ? { ...item, modelConfig: config } as Member : item))
  }, [])

  // 系统提示词单框直改：与普通 Agent 设置弹窗同一条链（agents.update），写该 Agent 定义的 system_prompt，全局生效。
  const saveMemberSystemPrompt = useCallback(async (member: TeamDockMember, systemPrompt: string): Promise<void> => {
    await useAgentStore.getState().updateAgent(member.agent_id, { systemPrompt })
    setMembers((current) => current.map((item) => item.id === member.id && (item as TeamDockMember).modelConfig
      ? { ...item, modelConfig: { ...(item as TeamDockMember).modelConfig!, agentSystemPrompt: systemPrompt } } as Member
      : item))
  }, [])

  // Master 模型档案直改 Agent 定义：选档案写 fixed+id，清空写 system+null（使用系统默认）；leader 团队行保持不动。
  const saveMasterAgentModel = useCallback(async (member: TeamDockMember, input: { modelProfileId: string | null }): Promise<void> => {
    await useAgentStore.getState().updateAgent(member.agent_id, {
      modelProfileId: input.modelProfileId,
      modelProfileMode: input.modelProfileId ? 'fixed' : 'system',
    })
    // 回读 config.get 以后端真相刷新（当前生效/dock 行与解析链保持同源，不本地推断）。
    const config = await wsClient.request({ type: 'team.member.config.get', memberId: member.id }) as TeamMemberModelConfig
    setMembers((current) => current.map((item) => item.id === member.id ? { ...item, modelConfig: config } as Member : item))
  }, [])

  const removeMember = useCallback(async (member: TeamDockMember): Promise<void> => {
    setRemoving(true)
    try {
      await wsClient.request({ type: 'team.member.remove', memberId: member.id })
      if (member.session_id) retainedSessions.current.add(member.session_id)
      setConfirmMemberId(null)
      setSettingsMemberId(null)
      await load()
    } catch (cause) {
      setError(`移除成员失败：${cause instanceof Error ? cause.message : '请重试'}`)
      setConfirmMemberId(null)
    } finally { setRemoving(false) }
  }, [load])

  if (renderSurface) return renderSurface(adapter)
  return (
    <main className="conversation-pane" data-conversation-pane style={{ position: 'relative' }}>
      <header className="conversation-header">
        <div className="conversation-target">
          <div className="conversation-agent-avatar">{(adapter.agentName || 'A').charAt(0).toUpperCase()}</div>
          <div>
            <div className="conversation-title"><strong>{adapter.agentName || 'Agent'}</strong>{adapter.sessionTitle && <><span>·</span><span>{adapter.sessionTitle}</span></>}</div>
            <div className="conversation-subtitle">{adapter.agentRuntime || 'runtime'} · {adapter.running ? '运行中' : '空闲'}{adapter.projectId ? ` · ${adapter.projectId}` : ''}</div>
          </div>
        </div>
        <div className="conversation-actions">
          {adapter.reload && <button type="button" onClick={() => { void adapter.reload?.() }} title="重新加载消息"><RefreshCw size={14} /></button>}
        </div>
      </header>
      <ConversationMessageList adapter={adapter} compactTeam location={location} onSeen={activity.markSeen} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} onOpenResource={onOpenResource} />
      {(adapter.pendingPermissions.length > 0 || adapter.pendingElicitations.length > 0 || adapter.interactionError) && <div className="conversation-interactions">
        {adapter.interactionError && <div className="conversation-interaction-error">{adapter.interactionError}</div>}
        <InteractionPanel permission={adapter.pendingPermissions[0]} elicitation={adapter.pendingPermissions.length === 0 ? adapter.pendingElicitations[0] : undefined} onRespondPermission={adapter.respondPermission} onRespondElicitation={adapter.respondElicitation} />
      </div>}
      {/* dock 悬浮层锚在此包裹层（= Composer 顶）上方右侧，消息列表恢复完整高度 */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {conversation && dockMembers.length > 0 && (
          <TeamAgentDock
            members={dockMembers}
            statusBySessionId={statusBySessionId}
            onLocate={locateMember}
            onCancelMember={cancelMemberTurn}
            onOpenSettings={(member) => setSettingsMemberId(member.id)}
            onRemoveRequest={(member) => { setSettingsMemberId(null); setConfirmMemberId(member.id) }}
          />
        )}
        <ConversationComposer key={adapter.sessionId ?? 'empty'} adapter={adapter} />
      </div>
      {settingsMember?.modelConfig && (
        <TeamAgentSettingsModal
          member={settingsMember}
          config={settingsMember.modelConfig}
          masterEffective={masterEffective}
          modelProfiles={modelProfiles}
          onLoadProfiles={loadModelProfiles}
          onSave={(input) => saveMemberConfig(settingsMember, input)}
          onSaveAgentModel={(input) => saveMasterAgentModel(settingsMember, input)}
          onSaveSystemPrompt={(systemPrompt) => saveMemberSystemPrompt(settingsMember, systemPrompt)}
          onRemoveRequest={() => { setSettingsMemberId(null); setConfirmMemberId(settingsMember.id) }}
          onClose={() => setSettingsMemberId(null)}
        />
      )}
      {confirmMember && (
        <TeamMemberRemoveConfirm
          memberName={confirmMember.name}
          busy={removing}
          onCancel={() => setConfirmMemberId(null)}
          onConfirm={() => { void removeMember(confirmMember) }}
        />
      )}
    </main>
  )
}
