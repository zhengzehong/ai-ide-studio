import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Bot, Loader2, User } from 'lucide-react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { TurnContentView } from './TurnContentView'
import { VirtualChatList } from './VirtualChatList'
import { FilesPresentationCard } from './FilesPresentationCard'
import { PreviewCard } from './PreviewCard'
import { buildChatRenderItems, type ChatRenderItem } from './render-items'
import { ConversationProcessBlock } from './ConversationProcessBlock'
import { AuthenticatedImage } from './AuthenticatedImage'
import { fmtTokens } from '../../pages/workspace/helpers'
import { elapsedSecondsBetween, formatCompactDuration } from '../../utils/duration'
import type { ChatTimelineGroup, MessageData } from '../../stores/session-events'
import type { TurnProcessBlock } from '../../stores/turn-blocks'
import type { ConversationAdapter, ConversationPaneProps } from './conversation-types'
import './conversation-pane.css'

interface Props extends Pick<ConversationPaneProps, 'onOpenPreview' | 'onOpenFiles' | 'onOpenResource'> { adapter: ConversationAdapter }

export function ConversationMessageList({ adapter, onOpenPreview, onOpenFiles, onOpenResource }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const messageCountRef = useRef(0)
  const olderAnchorRef = useRef<{ height: number; top: number } | null>(null)
  const messages = useMemo(() => adapter.sessionId ? adapter.messages.filter((message) => message.session_id === adapter.sessionId) : [], [adapter.messages, adapter.sessionId])
  const streaming = adapter.sessionId && adapter.streamingMessage && !adapter.streamingMessage.done ? adapter.streamingMessage : null
  const streamingBubble = useMemo<MessageData | null>(() => streaming ? {
    id: streaming.id,
    session_id: adapter.sessionId || '',
    role: 'agent',
    content: streaming.content,
    thinking: streaming.thinking,
    tool_calls_json: streaming.toolCalls.length ? JSON.stringify(streaming.toolCalls) : null,
    decision_json: null,
    attachments_json: null,
    timestamp: new Date().toISOString(),
    processBlocks: streaming.processBlocks,
    finalAnswer: streaming.finalAnswer,
    stage: streaming.stage,
    processDefaultOpen: true,
  } : null, [adapter.sessionId, streaming])
  const renderItems = useMemo<ChatRenderItem<MessageData>[]>(() => buildChatRenderItems({
    sessionId: adapter.sessionId,
    messages,
    events: adapter.events || [],
    streamingBubble,
    showStreamingBubble: !!streamingBubble,
    blockingInteraction: false,
  }), [adapter.events, adapter.sessionId, messages, streamingBubble])
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto'): void => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior }); pinnedRef.current = true
  }, [])
  const onResize = useCallback((): void => { if (pinnedRef.current) scrollToBottom() }, [scrollToBottom])
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    const onScroll = (): void => { pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100 }
    element.addEventListener('scroll', onScroll, { passive: true }); onScroll()
    return () => element.removeEventListener('scroll', onScroll)
  }, [adapter.sessionId])
  useEffect(() => {
    pinnedRef.current = true; messageCountRef.current = 0
    const frame = requestAnimationFrame(() => { scrollToBottom(); requestAnimationFrame(() => scrollToBottom()) })
    return () => cancelAnimationFrame(frame)
  }, [adapter.sessionId, scrollToBottom])
  useEffect(() => {
    const anchor = olderAnchorRef.current
    if (anchor && scrollRef.current && renderItems.length > messageCountRef.current) {
      scrollRef.current.scrollTop = anchor.top + (scrollRef.current.scrollHeight - anchor.height)
      olderAnchorRef.current = null
      messageCountRef.current = renderItems.length
      return
    }
    if (renderItems.length !== messageCountRef.current) {
      messageCountRef.current = renderItems.length
      if (pinnedRef.current) requestAnimationFrame(() => scrollToBottom('smooth'))
    }
    if (streaming && pinnedRef.current) requestAnimationFrame(() => scrollToBottom())
  }, [renderItems.length, scrollToBottom, streaming])
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
    {adapter.sessionId && adapter.error && <ErrorState text={adapter.error} />}
    {adapter.sessionId && !adapter.error && !adapter.loading && renderItems.length === 0 && <EmptyConversation text="暂无消息，开始对话吧" />}
    {adapter.loadingOlderMessages && <div className="conversation-sync">正在加载更早消息...</div>}
    {adapter.sessionId && <VirtualChatList key={adapter.sessionId} items={renderItems} getKey={(item) => item.id} scrollRef={scrollRef} onContentResize={onResize} renderItem={(item) => <ConversationRenderItem item={item} adapter={adapter} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} onOpenResource={onOpenResource} />} />}
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
  return <MessageShell human={human} agentName={adapter.agentName} timestamp={group.timestamp}>
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
    {!human && lastMessage?.kind === 'message' && lastMessage.turnStats && <TurnStatsView stats={lastMessage.turnStats} />}
  </MessageShell>
}

function ConversationMessage({ message, adapter, onOpenPreview, onOpenFiles, onOpenResource }: { message: MessageData; adapter: ConversationAdapter; onOpenPreview?: ConversationPaneProps['onOpenPreview']; onOpenFiles?: ConversationPaneProps['onOpenFiles']; onOpenResource?: ConversationPaneProps['onOpenResource'] }) {
  const isHuman = message.role === 'human'
  const processState = adapter.processByMessageId?.[message.id]
  const processBlocks = processState?.blocks ?? message.processBlocks ?? []
  const processCount = message.process_item_count ?? message.tool_call_count ?? (message.has_tool_calls ? 1 : 0)
  const presentations = message.parsedPresentations ?? []
  const stats = parseTurnStats(message.decision_json, message.started_at, message.completed_at)
  return <MessageShell human={isHuman} agentName={message.sender_name ?? adapter.agentName} timestamp={message.timestamp}>
    {message.parsedAttachments?.map((attachment, index) => <AuthenticatedImage key={`${message.id}-attachment-${index}`} image={attachment} alt={attachment.name || '附件'} style={{ maxWidth: 180, maxHeight: 140, borderRadius: 8, border: '1px solid var(--border)', objectFit: 'cover', marginBottom: 8 }} />)}
    <TurnContentView
      defaultProcessOpen={!!message.processDefaultOpen}
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
    {!isHuman && stats && <TurnStatsView stats={stats} />}
  </MessageShell>
}

function StreamingMessage({ message, adapter, onOpenPreview, onOpenFiles, onOpenResource }: { message: MessageData; adapter: ConversationAdapter; onOpenPreview?: ConversationPaneProps['onOpenPreview']; onOpenFiles?: ConversationPaneProps['onOpenFiles']; onOpenResource?: ConversationPaneProps['onOpenResource'] }) {
  const processBlocks = message.processBlocks || []
  const finalAnswer = message.finalAnswer || message.content || ''
  const hasBody = processBlocks.some((block) => block.kind !== 'stage') || !!finalAnswer
  return <MessageShell agentName={adapter.agentName} streaming streamingLabel={message.stage || '生成中'} showBubble={hasBody}><TurnContentView processBlocks={processBlocks} finalAnswer={finalAnswer} isStreaming processCount={message.process_item_count ?? processBlocks.length} defaultProcessOpen onOpenResource={onOpenResource} renderProcessBlock={(block, context) => <ProcessBlock block={block} adapter={adapter} messageId={message.id} isStreaming thinkingActive={context.thinkingActive} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} />} /></MessageShell>
}

function MessageShell({ children, human = false, agentName, timestamp, streaming = false, streamingLabel = '生成中', showBubble = true }: { children: React.ReactNode; human?: boolean; agentName?: string | null; timestamp?: string; streaming?: boolean; streamingLabel?: string; showBubble?: boolean }) {
  return <div className={`conversation-message${human ? ' is-human' : ''}`}><div className="conversation-avatar">{human ? <User size={14} /> : <Bot size={14} />}</div><div className="conversation-message-body"><div className="conversation-message-meta"><strong>{human ? '你' : agentName || 'Agent'}</strong>{timestamp && <time>{formatTime(timestamp)}</time>}{streaming && <span className="conversation-streaming-label"><Loader2 size={11} /> {streamingLabel}</span>}</div>{showBubble && <div className="conversation-bubble">{children}</div>}</div></div>
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

interface TurnStats {
  inputTokens?: number
  outputTokens?: number
  cachedReadTokens?: number
  costAmount?: number
  elapsedSeconds?: number
}

function parseTurnStats(raw?: string | null, startedAt?: string | null, completedAt?: string | null): TurnStats | null {
  const elapsedSecondsFromTimestamps = elapsedSecondsBetween(startedAt, completedAt)
  if (!raw) return elapsedSecondsFromTimestamps == null ? null : { elapsedSeconds: elapsedSecondsFromTimestamps }
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const stats = value as Record<string, unknown>
    return {
      inputTokens: typeof stats.inputTokens === 'number' ? stats.inputTokens : undefined,
      outputTokens: typeof stats.outputTokens === 'number' ? stats.outputTokens : undefined,
      cachedReadTokens: typeof stats.cachedReadTokens === 'number' ? stats.cachedReadTokens : undefined,
      costAmount: typeof stats.costAmount === 'number' ? stats.costAmount : undefined,
      elapsedSeconds: typeof stats.elapsedSeconds === 'number' ? stats.elapsedSeconds : elapsedSecondsFromTimestamps,
    }
  } catch { return null }
}

function TurnStatsView({ stats }: { stats: { inputTokens?: number; outputTokens?: number; cachedReadTokens?: number; costAmount?: number; elapsedSeconds?: number } }) {
  const hasStats = stats.elapsedSeconds != null || stats.inputTokens != null || stats.outputTokens != null || stats.cachedReadTokens != null || stats.costAmount != null
  if (!hasStats) return null
  return <div className="conversation-turn-stats">
    {stats.elapsedSeconds != null && <span>耗时 {formatCompactDuration(stats.elapsedSeconds)}</span>}
    {stats.inputTokens != null && <span>输入 <b>{fmtTokens(stats.inputTokens)}</b></span>}
    {stats.outputTokens != null && <span>输出 <b>{fmtTokens(stats.outputTokens)}</b></span>}
    {stats.cachedReadTokens != null && stats.cachedReadTokens > 0 && <span>缓存 <b>{fmtTokens(stats.cachedReadTokens)}</b></span>}
    {stats.costAmount != null && <span>${stats.costAmount.toFixed(4)}</span>}
  </div>
}
