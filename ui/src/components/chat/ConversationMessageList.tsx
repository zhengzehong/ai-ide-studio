import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Loader2, User } from 'lucide-react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { TurnContentView } from './TurnContentView'
import { VirtualChatList } from './VirtualChatList'
import { FilesPresentationCard } from './FilesPresentationCard'
import { PreviewCard } from './PreviewCard'
import type { MessageData } from '../../stores/session-events'
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
    if (anchor && scrollRef.current && messages.length > messageCountRef.current) {
      scrollRef.current.scrollTop = anchor.top + (scrollRef.current.scrollHeight - anchor.height)
      olderAnchorRef.current = null
      messageCountRef.current = messages.length
      return
    }
    if (messages.length !== messageCountRef.current) {
      messageCountRef.current = messages.length
      if (pinnedRef.current) requestAnimationFrame(() => scrollToBottom('smooth'))
    }
    if (streaming && pinnedRef.current) requestAnimationFrame(() => scrollToBottom())
  }, [messages.length, scrollToBottom, streaming])
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
    {adapter.sessionId && !adapter.error && !adapter.loading && messages.length === 0 && !streaming && <EmptyConversation text="暂无消息，开始对话吧" />}
    {adapter.loadingOlderMessages && <div className="conversation-sync">正在加载更早消息...</div>}
    {adapter.sessionId && <VirtualChatList key={adapter.sessionId} items={messages} getKey={(message) => message.id} scrollRef={scrollRef} onContentResize={onResize} renderItem={(message) => <ConversationMessage message={message} adapter={adapter} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} onOpenResource={onOpenResource} />} />}
    {streaming && <StreamingMessage message={streaming} adapter={adapter} onOpenResource={onOpenResource} />}
  </div>
}

function ConversationMessage({ message, adapter, onOpenPreview, onOpenFiles, onOpenResource }: { message: MessageData; adapter: ConversationAdapter; onOpenPreview?: ConversationPaneProps['onOpenPreview']; onOpenFiles?: ConversationPaneProps['onOpenFiles']; onOpenResource?: ConversationPaneProps['onOpenResource'] }) {
  const isHuman = message.role === 'human'
  const processState = adapter.processByMessageId?.[message.id]
  const processBlocks = processState?.blocks ?? message.processBlocks ?? []
  const processCount = message.process_item_count ?? message.tool_call_count ?? (message.has_tool_calls ? 1 : 0)
  const presentations = message.parsedPresentations ?? []
  return <MessageShell human={isHuman} agentName={adapter.agentName} timestamp={message.timestamp}>
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
      renderProcessBlock={(block) => <ProcessBlock block={block} adapter={adapter} messageId={message.id} />}
      renderPreviewPresentation={onOpenPreview ? (preview) => <PreviewCard preview={preview} onOpen={() => onOpenPreview(preview)} /> : undefined}
      renderFilesPresentation={onOpenFiles ? (presentation) => <FilesPresentationCard presentation={presentation} onOpen={onOpenFiles} /> : undefined}
    />
  </MessageShell>
}

function StreamingMessage({ message, adapter, onOpenResource }: { message: NonNullable<ConversationAdapter['streamingMessage']>; adapter: ConversationAdapter; onOpenResource?: ConversationPaneProps['onOpenResource'] }) {
  return <MessageShell agentName={adapter.agentName} streaming><TurnContentView processBlocks={message.processBlocks} finalAnswer={message.finalAnswer || message.stage || '正在处理...'} isStreaming processCount={message.processBlocks.length} defaultProcessOpen onOpenResource={onOpenResource} renderProcessBlock={(block) => <ProcessBlock block={block} adapter={adapter} messageId={message.id} />} /><span className="conversation-streaming-label"><Loader2 size={11} /> 生成中</span></MessageShell>
}

function MessageShell({ children, human = false, agentName, timestamp, streaming = false }: { children: React.ReactNode; human?: boolean; agentName?: string | null; timestamp?: string; streaming?: boolean }) {
  return <div className={`conversation-message${human ? ' is-human' : ''}`}><div className="conversation-avatar">{human ? <User size={14} /> : <Bot size={14} />}</div><div className="conversation-message-body"><div className="conversation-message-meta"><strong>{human ? '你' : agentName || 'Agent'}</strong>{timestamp && <time>{formatTime(timestamp)}</time>}{streaming && <span className="conversation-streaming-label"><Loader2 size={11} /> 生成中</span>}</div><div className="conversation-bubble">{children}</div></div></div>
}

function ProcessBlock({ block, adapter, messageId }: { block: TurnProcessBlock; adapter: ConversationAdapter; messageId: string }) {
  if (block.kind === 'tool') return <ToolProcessBlock block={block} adapter={adapter} messageId={messageId} />
  if (block.kind === 'thinking') return <div className="conversation-process-thinking"><span>思考过程</span><MarkdownRenderer content={block.text} /></div>
  if (block.kind === 'file_change') return <div className="conversation-process-item">文件变更{block.summary ? `：${block.summary}` : ''}</div>
  if (block.kind === 'plan') return <div className="conversation-process-item">计划 · {block.summary || `${block.plan.length} 项`}</div>
  if (block.kind === 'permission' || block.kind === 'elicitation') return <div className="conversation-process-item">{block.title}</div>
  if (block.kind === 'stage' || block.kind === 'note') return <div className="conversation-process-item">{block.text}</div>
  return null
}

function ToolProcessBlock({ block, adapter, messageId }: { block: Extract<TurnProcessBlock, { kind: 'tool' }>; adapter: ConversationAdapter; messageId: string }) {
  const [open, setOpen] = useState(false)
  const key = `${messageId}:${block.id}`
  const detail = adapter.toolCallDetailsByKey?.[key]
  const detailText = detail?.rawOutputPreview || detail?.rawInputPreview || detail?.terminalOutputTail || block.toolCall.terminalOutput || ''
  const hasDetail = !!block.hasDetail || !!detailText
  return <div className="conversation-process-item"><button type="button" className="conversation-process-toggle" onClick={() => { setOpen((value) => !value); if (!detail && block.hasDetail) void adapter.loadProcessItemDetail(messageId, block.id) }}><strong>{block.toolCall.title}</strong>{block.toolCall.status && <span> · {block.toolCall.status}</span>}{hasDetail && <span className="conversation-process-more">{open ? '收起' : '详情'}</span>}</button>{open && detailText && <pre>{detailText}</pre>}{open && adapter.processItemLoadingByKey?.[key] && <span>正在加载详情...</span>}{open && adapter.processItemErrorByKey?.[key] && <span className="conversation-process-error">{adapter.processItemErrorByKey[key]}</span>}</div>
}

function EmptyConversation({ text }: { text: string }) { return <div className="conversation-empty"><Bot size={48} /><div>{text}</div></div> }
function LoadingState({ text }: { text: string }) { return <div className="conversation-state"><Loader2 size={18} /><div>{text}</div></div> }
function ErrorState({ text }: { text: string }) { return <div className="conversation-state is-error" role="alert">{text}</div> }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
