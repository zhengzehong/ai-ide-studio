import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Bot, Loader2, User, X } from 'lucide-react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { TurnContentView } from './TurnContentView'
import { VirtualChatList } from './VirtualChatList'
import { FilesPresentationCard } from './FilesPresentationCard'
import { PreviewCard } from './PreviewCard'
import { buildChatRenderItems, type ChatRenderItem } from './render-items'
import { ConversationProcessBlock } from './ConversationProcessBlock'
import { AuthenticatedImage } from './AuthenticatedImage'
import { TeamAssignmentBlock } from './TeamAssignmentBlock'
import { TeamMessageVisibility } from '../team/TeamActivityBar'
import { TurnStatsFooter } from './TurnStatsFooter'
import { parseTurnStats } from './turn-stats'
import type { ChatTimelineGroup, MessageData } from '../../stores/session-events'
import type { TurnProcessBlock } from '../../stores/turn-blocks'
import type { ConversationAdapter, ConversationPaneProps } from './conversation-types'
import './conversation-pane.css'

interface Props extends Pick<ConversationPaneProps, 'onOpenPreview' | 'onOpenFiles' | 'onOpenResource'> {
  adapter: ConversationAdapter
  compactTeam?: boolean
  location?: { messageId: string; request: number }
  onSeen?: (id: string) => void
}

export function ConversationMessageList({ adapter, compactTeam = false, location, onSeen, onOpenPreview, onOpenFiles, onOpenResource }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const navigationLock = useRef(false)
  const viewAdapter = compactTeam ? { ...adapter, compactProcess: true } : adapter
  const messageCountRef = useRef(0)
  const olderAnchorRef = useRef<{ height: number; top: number } | null>(null)
  const messages = useMemo(() => adapter.sessionId ? adapter.messages.filter((message) => message.session_id === adapter.sessionId) : [], [adapter.messages, adapter.sessionId])
  const streamingTurns = (adapter.streamingMessages?.length ? adapter.streamingMessages : adapter.streamingMessage ? [adapter.streamingMessage] : []).filter((turn) => !turn.done)
  const streamingBubbles = useMemo<MessageData[]>(() => streamingTurns.map((streaming) => ({ id: streaming.id, session_id: adapter.sessionId || '', role: 'agent', content: streaming.content, thinking: streaming.thinking, tool_calls_json: streaming.toolCalls.length ? JSON.stringify(streaming.toolCalls) : null, decision_json: streaming.turnStats ? JSON.stringify(streaming.turnStats) : null, attachments_json: null, timestamp: streaming.startedAt || '', started_at: streaming.startedAt, processBlocks: streaming.processBlocks, finalAnswer: streaming.finalAnswer, stage: streaming.stage, sender_name: streaming.senderName, processDefaultOpen: true })), [adapter.sessionId, streamingTurns])
  const streamingSignature = useMemo(() => streamingTurns.map((turn) => [turn.id, turn.content.length, turn.thinking.length, turn.processBlocks.length, turn.toolCalls.length, turn.stage || ''].join(':')).join('|'), [streamingTurns])
  const visibleMessages = useMemo(() => {
    const ids = new Set(streamingBubbles.map((message) => message.id))
    return ids.size ? messages.filter((message) => !ids.has(message.id)) : messages
  }, [messages, streamingBubbles])
  const renderItems = useMemo<ChatRenderItem<MessageData>[]>(() => buildChatRenderItems({
    sessionId: adapter.sessionId,
    messages: visibleMessages,
    events: adapter.events || [],
    streamingBubble: streamingBubbles[0] || null,
    showStreamingBubble: false,
    blockingInteraction: false,
  }), [adapter.events, adapter.sessionId, streamingBubbles, visibleMessages])
  const allRenderItems = useMemo(() => [...renderItems, ...streamingBubbles.map((message) => ({ id: `streaming:${message.id}`, kind: 'streaming' as const, message }))], [renderItems, streamingBubbles])
  const targetKey = location && allRenderItems.find(item => (item.kind === 'message' || item.kind === 'streaming') && item.message.id === location.messageId)?.id
  const scrollTarget = useMemo(() => targetKey && location ? { key: targetKey, request: location.request } : undefined, [targetKey, location])
  useEffect(() => { if (location) { navigationLock.current = true; pinnedRef.current = false } }, [location])
  useEffect(() => { if (adapter.sending) { navigationLock.current = false; pinnedRef.current = true } }, [adapter.sending])
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto'): void => {
    if (navigationLock.current) return
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior }); pinnedRef.current = true
  }, [])
  const onResize = useCallback((): void => { if (pinnedRef.current) scrollToBottom() }, [scrollToBottom])
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    const onScroll = (): void => { if (!navigationLock.current) pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100 }
    const manualScroll = (): void => { navigationLock.current = false }
    element.addEventListener('wheel', manualScroll, { passive: true }); element.addEventListener('touchstart', manualScroll, { passive: true }); element.addEventListener('pointerdown', manualScroll)
    element.addEventListener('scroll', onScroll, { passive: true }); onScroll()
    return () => { element.removeEventListener('scroll', onScroll); element.removeEventListener('wheel', manualScroll); element.removeEventListener('touchstart', manualScroll); element.removeEventListener('pointerdown', manualScroll) }
  }, [adapter.sessionId])
  useEffect(() => {
    navigationLock.current = false; pinnedRef.current = true; messageCountRef.current = 0
    const frame = requestAnimationFrame(() => { scrollToBottom(); requestAnimationFrame(() => scrollToBottom()) })
    return () => cancelAnimationFrame(frame)
  }, [adapter.sessionId, scrollToBottom])
  useEffect(() => {
    const anchor = olderAnchorRef.current
    if (anchor && scrollRef.current && allRenderItems.length > messageCountRef.current) {
      scrollRef.current.scrollTop = anchor.top + (scrollRef.current.scrollHeight - anchor.height)
      olderAnchorRef.current = null
      messageCountRef.current = allRenderItems.length
      return
    }
    if (allRenderItems.length !== messageCountRef.current) {
      messageCountRef.current = allRenderItems.length
      if (pinnedRef.current) requestAnimationFrame(() => scrollToBottom('smooth'))
    }
    if (streamingBubbles.length > 0 && pinnedRef.current) requestAnimationFrame(() => scrollToBottom())
  }, [allRenderItems.length, scrollToBottom, streamingBubbles.length, streamingSignature])
  const loadOlder = (): void => {
    if (adapter.hasMoreMessages && !adapter.loadingOlderMessages) {
      const element = scrollRef.current
      if (element) olderAnchorRef.current = { height: element.scrollHeight, top: element.scrollTop }
      void adapter.loadOlderMessages()
    }
  }
  return <div className="conversation-message-scroll" ref={scrollRef} onScroll={(event) => { if (event.currentTarget.scrollTop <= 120) loadOlder() }}>
    {!adapter.sessionId && <EmptyConversation text="选择一个 Session 或新建会话" />}
    {adapter.sessionId && adapter.loading && messages.length === 0 && <LoadingState text="正在加载消息..." />}
    {adapter.sessionId && adapter.loading && messages.length > 0 && <div className="conversation-sync" role="status" aria-live="polite"><Loader2 size={13} /> 正在同步消息...</div>}
    {adapter.sessionId && adapter.error && <ErrorState text={adapter.error} />}
    {adapter.sessionId && !adapter.error && !adapter.loading && allRenderItems.length === 0 && <EmptyConversation text="暂无消息，开始对话吧" />}
    {adapter.loadingOlderMessages && <div className="conversation-sync">正在加载更早消息...</div>}
    {adapter.sessionId && <VirtualChatList key={adapter.sessionId} items={allRenderItems} getKey={(item) => item.id} scrollRef={scrollRef} scrollTarget={scrollTarget} onContentResize={onResize} renderItem={(item) => {
      const content = <ConversationRenderItem item={item} adapter={viewAdapter} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} onOpenResource={onOpenResource} />
      return compactTeam && onSeen && item.kind === 'message' && item.message.role === 'agent'
        ? <TeamMessageVisibility messageId={item.message.id} completed={item.message.status !== 'running'} scrollRef={scrollRef} onSeen={onSeen}>{content}</TeamMessageVisibility> : content
    }} />}
  </div>
}

function ConversationRenderItem({ item, adapter, onOpenPreview, onOpenFiles, onOpenResource }: { item: ChatRenderItem<MessageData>; adapter: ConversationAdapter; onOpenPreview?: ConversationPaneProps['onOpenPreview']; onOpenFiles?: ConversationPaneProps['onOpenFiles']; onOpenResource?: ConversationPaneProps['onOpenResource'] }) {
  if (item.kind === 'group') return <TimelineGroupMessage group={item.group} adapter={adapter} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} onOpenResource={onOpenResource} />
  if (item.kind === 'streaming') return <StreamingMessage message={item.message} adapter={adapter} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} onOpenResource={onOpenResource} />
  if (item.kind === 'blocking') return null
  return <ConversationMessage message={item.message} adapter={adapter} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} onOpenResource={onOpenResource} />
}

function TimelineGroupMessage({ group, adapter, onOpenPreview, onOpenFiles, onOpenResource }: { group: ChatTimelineGroup; adapter: ConversationAdapter; onOpenPreview?: ConversationPaneProps['onOpenPreview']; onOpenFiles?: ConversationPaneProps['onOpenFiles']; onOpenResource?: ConversationPaneProps['onOpenResource'] }) {
  const human = group.role === 'human'
  const lastMessage = [...group.blocks].reverse().find((block) => block.kind === 'message')
  return <MessageShell human={human} agentName={adapter.agentName} timestamp={group.timestamp} footer={!human && lastMessage?.kind === 'message' && <TurnStatsFooter stats={lastMessage.turnStats} />}>
    {group.blocks.map((block) => {
      if (block.kind === 'tool') {
        const processBlock: TurnProcessBlock = { id: block.id, kind: 'tool', toolCall: block.toolCall }
        return <ConversationProcessBlock key={block.id} block={processBlock} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} />
      }
      return <div key={block.id} className="conversation-timeline-text">
        {block.attachments?.map((attachment, index) => <AuthenticatedImage key={`${block.id}-attachment-${index}`} image={attachment} alt={attachment.name || '附件'} style={{ maxWidth: 180, maxHeight: 140, borderRadius: 8, border: '1px solid var(--border)', objectFit: 'cover' }} />)}
        {block.thinking && <ConversationProcessBlock block={{ id: `${block.id}:thinking`, kind: 'thinking', text: block.thinking }} />}
        {block.content && <MarkdownRenderer content={block.content} onOpenResource={onOpenResource} />}
      </div>
    })}
  </MessageShell>
}

function ConversationMessage({ message, adapter, onOpenPreview, onOpenFiles, onOpenResource }: { message: MessageData; adapter: ConversationAdapter; onOpenPreview?: ConversationPaneProps['onOpenPreview']; onOpenFiles?: ConversationPaneProps['onOpenFiles']; onOpenResource?: ConversationPaneProps['onOpenResource'] }) {
  // 平台自动触发的 prompt(如 Team Leader 唤醒)不是用户说的话,渲染成系统通知而不是"你"的气泡。
  if (message.role === 'human' && message.sender_role === 'team-system') return <SystemNotice message={message} />
  const isHuman = message.role === 'human'
  const failed = message.status === 'failed'
  const processState = adapter.processByMessageId?.[message.id]
  const processBlocks = processState?.blocks ?? message.processBlocks ?? []
  const processCount = message.process_item_count ?? message.tool_call_count ?? (message.has_tool_calls ? 1 : 0)
  const presentations = message.parsedPresentations ?? []
  const stats = parseTurnStats(message.decision_json, message.started_at, message.completed_at)
  return <MessageShell human={isHuman} failed={failed} agentName={message.sender_name ?? adapter.agentName} timestamp={message.timestamp} footer={!isHuman && <TurnStatsFooter stats={stats} />}>
    {message.teamAssignment && <TeamAssignmentBlock assignment={message.teamAssignment} />}
    {message.parsedAttachments?.map((attachment, index) => <AuthenticatedImage key={`${message.id}-attachment-${index}`} image={attachment} alt={attachment.name || '附件'} style={{ maxWidth: 180, maxHeight: 140, borderRadius: 8, border: '1px solid var(--border)', objectFit: 'cover', marginBottom: 8 }} />)}
    <TurnContentView
      defaultProcessOpen={!adapter.compactProcess && !!message.processDefaultOpen}
      processBlocks={processBlocks}
      finalAnswer={message.finalAnswer ?? message.content}
      isStreaming={false}
      processCount={processCount}
      processLoaded={processState?.loaded ?? !!message.processBlocks}
      processLoading={processState?.loading}
      processError={processState?.error}
      fileChangesSummary={message.parsedFileChanges}
      fileChangesDetail={adapter.fileChangeDetailsByMessageId?.[message.id]}
      fileChangesLoading={adapter.fileChangeLoadingByKey?.[`file:${message.id}`]}
      fileChangesError={adapter.fileChangeErrorByKey?.[`file:${message.id}`]}
      previewPresentations={presentations.filter((item) => item.kind === 'preview')}
      filesPresentations={presentations.filter((item) => item.kind === 'files')}
      onLoadProcess={processCount > 0 ? () => { void adapter.loadMessageProcess(message.id) } : undefined}
      onLoadFileChanges={message.has_file_changes ? () => { void adapter.loadFileChanges(message.id) } : undefined}
      onOpenResource={onOpenResource}
      renderProcessBlock={(block, context) => <ProcessBlock block={block} adapter={adapter} messageId={message.id} thinkingActive={context.thinkingActive} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} />}
      renderPreviewPresentation={onOpenPreview ? (preview) => <PreviewCard preview={preview} onOpen={() => onOpenPreview(preview)} /> : undefined}
      renderFilesPresentation={onOpenFiles ? (presentation) => <FilesPresentationCard presentation={presentation} onOpen={onOpenFiles} /> : undefined}
    />
  </MessageShell>
}

function StreamingMessage({ message, adapter, onOpenPreview, onOpenFiles, onOpenResource }: { message: MessageData; adapter: ConversationAdapter; onOpenPreview?: ConversationPaneProps['onOpenPreview']; onOpenFiles?: ConversationPaneProps['onOpenFiles']; onOpenResource?: ConversationPaneProps['onOpenResource'] }) {
  const processBlocks = message.processBlocks || []
  const finalAnswer = message.finalAnswer || message.content || ''
  const failed = message.stage?.includes('失败') === true
  const stage = message.stage || (!finalAnswer ? '正在思考...' : undefined)
  const stageOnly = adapter.compactProcess && !failed && !!message.stage && !finalAnswer && !processBlocks.some(block => block.kind !== 'stage')
  return <MessageShell hideBubble={stageOnly && !message.teamAssignment} agentName={message.sender_name ?? adapter.agentName} timestamp={message.timestamp} failed={failed} streaming streamingLabel={failed ? '执行失败' : stage || '生成中'} footer={<TurnStatsFooter streaming startedAt={message.started_at} stats={parseTurnStats(message.decision_json)} />}>
    {message.teamAssignment && <TeamAssignmentBlock assignment={message.teamAssignment} />}
    {!stageOnly && <TurnContentView processBlocks={processBlocks} finalAnswer={finalAnswer} isStreaming compactStreamingProcess={adapter.compactProcess} fallbackStage={adapter.compactProcess ? message.stage : stage} processCount={message.process_item_count} defaultProcessOpen onOpenResource={onOpenResource} renderProcessBlock={(block, context) => <ProcessBlock block={block} adapter={adapter} messageId={message.id} isStreaming thinkingActive={context.thinkingActive} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} />} />}
  </MessageShell>
}

function SystemNotice({ message }: { message: MessageData }) {
  return <div className="conversation-system-notice"><div className="conversation-system-notice-meta"><strong>{message.sender_name || '系统'}</strong>{message.timestamp && <time>{formatTime(message.timestamp)}</time>}</div><div className="conversation-system-notice-body"><MarkdownRenderer content={message.content} /></div></div>
}

function MessageShell({ children, footer, human = false, failed = false, hideBubble = false, agentName, timestamp, streaming = false, streamingLabel = '生成中' }: { children: React.ReactNode; footer?: React.ReactNode; human?: boolean; failed?: boolean; hideBubble?: boolean; agentName?: string | null; timestamp?: string; streaming?: boolean; streamingLabel?: string }) {
  return <div className={`conversation-message${human ? ' is-human' : ''}${failed ? ' is-failed' : ''}`}><div className="conversation-avatar">{human ? <User size={14} /> : <Bot size={14} />}</div><div className="conversation-message-body"><div className="conversation-message-meta"><strong>{human ? '你' : agentName || 'Agent'}</strong>{timestamp && <time>{formatTime(timestamp)}</time>}{streaming && <span className={`conversation-streaming-label${failed ? ' is-failed' : ''}`}>{failed ? <X size={11} /> : <Loader2 size={11} />} {streamingLabel}</span>}{failed && !streaming && <span className="conversation-failed-label">执行失败</span>}</div>{!hideBubble && <div className="conversation-bubble">{children}</div>}{footer}</div></div>
}

function ProcessBlock({ block, adapter, messageId, isStreaming = false, thinkingActive = false, onOpenPreview, onOpenFiles }: { block: TurnProcessBlock; adapter: ConversationAdapter; messageId: string; isStreaming?: boolean; thinkingActive?: boolean; onOpenPreview?: ConversationPaneProps['onOpenPreview']; onOpenFiles?: ConversationPaneProps['onOpenFiles'] }) {
  const key = `${messageId}:${block.id}`
  return <ConversationProcessBlock
    block={block}
    isStreaming={isStreaming}
    thinkingActive={thinkingActive}
    detailLoading={adapter.processItemLoadingByKey?.[key]}
    detailError={adapter.processItemErrorByKey?.[key]}
    onLoadDetail={'hasDetail' in block && block.hasDetail ? () => { void adapter.loadProcessItemDetail(messageId, block.id) } : undefined}
    onOpenPreview={onOpenPreview}
    onOpenFiles={onOpenFiles}
  />
}

function EmptyConversation({ text }: { text: string }) { return <div className="conversation-empty"><Bot size={48} /><div>{text}</div></div> }
function LoadingState({ text }: { text: string }) { return <div className="conversation-state"><Loader2 size={18} /><div>{text}</div></div> }
function ErrorState({ text }: { text: string }) { return <div className="conversation-state is-error" role="alert">{text}</div> }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
