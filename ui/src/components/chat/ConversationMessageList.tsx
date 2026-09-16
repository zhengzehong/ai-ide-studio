import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Bot, Loader2, User, X } from 'lucide-react'
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
import { isNearBottom, POINTER_DRAG_INTENT_PX, REPLAY_REANCHOR_MAX_PX, resolveScrollFollow, SCROLL_FOLLOW_THRESHOLD_PX, shouldReanchorAfterContentChange, streamingScrollSignature, type ScrollReleaseReason } from './auto-scroll'
import './conversation-pane.css'

/** 初始定位宽限：挂载/切会话/重放合并后 0–500ms 是恢复合并 + 虚拟测量修正的高度剧变窗口，
 *  窗口内滚动事件不降级 pinned（手动滚动/追底会提前解除）；超时兜底。 */
const INITIAL_LOCATE_GRACE_MS = 500

/** 「回到底部」悬浮按钮的出现门槛：解 pin 且距底超过它（与再锚定上限同源，避免按钮与自动追底打架）。 */
const JUMP_TO_BOTTOM_MIN_DISTANCE_PX = REPLAY_REANCHOR_MAX_PX

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
  // 增长豁免判定的上一次度量：scrollHeight 增长且非用户上行滚动时不算离开底部。
  const lastScrollHeightRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  // 初始定位宽限标记（见 INITIAL_LOCATE_GRACE_MS 注释）与"用户手动滚动待判定"标记。
  const initialLocateGraceRef = useRef(false)
  const manualScrollPendingRef = useRef(false)
  const scheduledScrollRef = useRef<number[]>([])
  const graceTimerRef = useRef<number | undefined>(undefined)
  // 释放原因 + 指针按下状态：pointerdown 单独不算"用户要自己看"，只有真实拖拽（位移超阈值）
  // 或按下中发生的上行（滚动条拖拽）才解除跟随；纯程序性回落保持跟随（见 auto-scroll.ts 注释）。
  const releaseReasonRef = useRef<ScrollReleaseReason | null>(null)
  const pointerPressedRef = useRef(false)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  /** 内容版本号（重放合并/刷新落地时递增）：驱动"重放后再锚定"，见下方 effect。 */
  const contentRevision = adapter.contentRevision ?? 0
  const messages = useMemo(() => adapter.sessionId ? adapter.messages.filter((message) => message.session_id === adapter.sessionId) : [], [adapter.messages, adapter.sessionId])
  const streamingTurns = (adapter.streamingMessages?.length ? adapter.streamingMessages : adapter.streamingMessage ? [adapter.streamingMessage] : []).filter((turn) => !turn.done)
  const streamingBubbles = useMemo<MessageData[]>(() => streamingTurns.map((streaming) => ({ id: streaming.id, session_id: adapter.sessionId || '', role: 'agent', content: streaming.content, thinking: streaming.thinking, tool_calls_json: streaming.toolCalls.length ? JSON.stringify(streaming.toolCalls) : null, decision_json: streaming.turnStats ? JSON.stringify(streaming.turnStats) : null, attachments_json: null, timestamp: streaming.startedAt || '', started_at: streaming.startedAt, processBlocks: streaming.processBlocks, finalAnswer: streaming.finalAnswer, stage: streaming.stage, sender_name: streaming.senderName, processDefaultOpen: true })), [adapter.sessionId, streamingTurns])
  // 签名除正文/思考/过程块数量外，还带上末个工具的状态与输出长度：工具长跑（terminalOutput/progress
  // 持续增长、无新 chunk）时也要触发跟随，对齐 Workspace 的 streamingScrollSignature。
  const streamingSignature = useMemo(() => streamingScrollSignature(streamingTurns), [streamingTurns])
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
    releaseReasonRef.current = null
    lastScrollHeightRef.current = element.scrollHeight
    lastScrollTopRef.current = element.scrollTop
  }, [])
  const onResize = useCallback((): void => { if (pinnedRef.current) scrollToBottom() }, [scrollToBottom])
  const cancelScheduledScroll = useCallback((): void => {
    scheduledScrollRef.current.forEach((id) => { cancelAnimationFrame(id); window.clearTimeout(id) })
    scheduledScrollRef.current = []
  }, [])
  // 挂载/条目变化后的延迟兜底：虚拟测量修正、恢复合并、图片/工具块撑高都会在首帧之后
  // 异步改变高度，单帧 rAF 追不到最终底部——照抄 Workspace.scheduleScrollToBottom 的
  // rAF + 40ms + 160ms 两次 instant 重定位（不做 smooth：动画目标取开始时的高度，期间增长会落点偏短）。
  const scheduleScrollToBottom = useCallback((): void => {
    if (navigationLock.current) return
    cancelScheduledScroll()
    const run = (): void => { if (pinnedRef.current) scrollToBottom() }
    scheduledScrollRef.current.push(
      requestAnimationFrame(run),
      window.setTimeout(run, 40),
      window.setTimeout(run, 160),
    )
  }, [cancelScheduledScroll, scrollToBottom])
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    const onScroll = (): void => {
      const metrics = { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, clientHeight: element.clientHeight }
      if (navigationLock.current) {
        lastScrollHeightRef.current = metrics.scrollHeight
        lastScrollTopRef.current = metrics.scrollTop
        return
      }
      const decision = resolveScrollFollow({
        pinned: pinnedRef.current,
        grace: initialLocateGraceRef.current,
        manual: manualScrollPendingRef.current,
        pressed: pointerPressedRef.current,
        release: releaseReasonRef.current,
        metrics,
        previousScrollHeight: lastScrollHeightRef.current,
        previousScrollTop: lastScrollTopRef.current,
        thresholdPx: SCROLL_FOLLOW_THRESHOLD_PX,
      })
      manualScrollPendingRef.current = false
      pinnedRef.current = decision.pinned
      initialLocateGraceRef.current = decision.grace
      releaseReasonRef.current = decision.release
      lastScrollHeightRef.current = metrics.scrollHeight
      lastScrollTopRef.current = metrics.scrollTop
      setShowJumpToBottom(!decision.pinned && metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight > JUMP_TO_BOTTOM_MIN_DISTANCE_PX)
    }
    // 真实用户滚动意图：wheel / touchstart 立即解除跟随并清除宽限；pointerdown 单独不算
    // （点击消息区/展开过程块/选中文字都不是"我要自己看历史"），需按下后位移超阈值或拖拽中上行。
    const manualScroll = (): void => { navigationLock.current = false; manualScrollPendingRef.current = true; initialLocateGraceRef.current = false }
    const onPointerDown = (event: PointerEvent): void => {
      pointerPressedRef.current = true
      pointerStartRef.current = { x: event.clientX, y: event.clientY }
      // 滚动条槽位里的按下＝拖拽意图（Chromium 把滚动条事件派发给元素本身）。
      // offsetX 是 target 的相对坐标：子元素冒泡上来的事件必须排除，否则用子坐标和容器 clientWidth 比较会误判。
      if (event.target === element && event.offsetX >= element.clientWidth - 1) manualScroll()
    }
    const onPointerMove = (event: PointerEvent): void => {
      const start = pointerStartRef.current
      if (!pointerPressedRef.current || !start) return
      if (Math.abs(event.clientY - start.y) + Math.abs(event.clientX - start.x) >= POINTER_DRAG_INTENT_PX) manualScroll()
    }
    const onPointerUp = (): void => { pointerPressedRef.current = false; pointerStartRef.current = null }
    element.addEventListener('wheel', manualScroll, { passive: true }); element.addEventListener('touchstart', manualScroll, { passive: true })
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove, { passive: true })
    // 松手/取消挂 window：拖到元素外松开也要复位按下态，否则"无按键悬停移动 ≥8px"会误 arm manual（sticky 冻结）。
    window.addEventListener('pointerup', onPointerUp, { passive: true }); window.addEventListener('pointercancel', onPointerUp, { passive: true })
    element.addEventListener('scroll', onScroll, { passive: true }); onScroll()
    return () => { element.removeEventListener('scroll', onScroll); element.removeEventListener('wheel', manualScroll); element.removeEventListener('touchstart', manualScroll); element.removeEventListener('pointerdown', onPointerDown); element.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('pointercancel', onPointerUp) }
  }, [adapter.sessionId])
  useEffect(() => {
    navigationLock.current = false; pinnedRef.current = true; messageCountRef.current = 0
    manualScrollPendingRef.current = false; initialLocateGraceRef.current = true
    releaseReasonRef.current = null; pointerPressedRef.current = false; pointerStartRef.current = null
    const element = scrollRef.current
    lastScrollHeightRef.current = element?.scrollHeight ?? 0
    lastScrollTopRef.current = element?.scrollTop ?? 0
    window.clearTimeout(graceTimerRef.current)
    graceTimerRef.current = window.setTimeout(() => { initialLocateGraceRef.current = false }, INITIAL_LOCATE_GRACE_MS)
    scheduleScrollToBottom()
    return () => { window.clearTimeout(graceTimerRef.current); cancelScheduledScroll() }
  }, [adapter.sessionId, scheduleScrollToBottom, cancelScheduledScroll])
  // 重放/内容版本落地后的补偿性再锚定：两段式装载的第二波（重放合并）不改变条目数，
  // 唯一带自动恢复的条目数分支不执行，视口会永久冻结在半中间——这里按"内容版本"重新判定：
  // 只要不是用户明确在看历史（release=manual）且贴底或距底 ≤600px，就重新追底并重置宽限窗口。
  useEffect(() => {
    if (!contentRevision) return
    // dock「定位成员」等定位锁生效中：此时不得再锚定（会无视锁、清锁并把定位目标卷走）。
    if (navigationLock.current) return
    const element = scrollRef.current
    if (!element) return
    const metrics = { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, clientHeight: element.clientHeight }
    if (!shouldReanchorAfterContentChange({ pinned: pinnedRef.current, release: releaseReasonRef.current, metrics, maxPx: REPLAY_REANCHOR_MAX_PX })) return
    pinnedRef.current = true
    releaseReasonRef.current = null
    navigationLock.current = false
    // 宽限起算点对齐"重放合并完成"：合并后的测量修正窗口内不因高度剧变降级 pinned。
    initialLocateGraceRef.current = true
    window.clearTimeout(graceTimerRef.current)
    graceTimerRef.current = window.setTimeout(() => { initialLocateGraceRef.current = false }, INITIAL_LOCATE_GRACE_MS)
    setShowJumpToBottom(false)
    scheduleScrollToBottom()
  }, [contentRevision, scheduleScrollToBottom])
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
      const element = scrollRef.current
      // pinned=false 但视口仍贴近底部时也跟随（自动恢复，对照 Workspace）——
      // 历史锁死的兜底解：误杀过的 pinned 在内容增高的常见场景下自行恢复。
      if (pinnedRef.current || (element && isNearBottom(element, SCROLL_FOLLOW_THRESHOLD_PX))) scheduleScrollToBottom()
    }
    // 流式 chunk 的追底 rAF 与用户 wheel 存在次序竞态：调度时 pinned 为真、执行前用户已手动
    // 上滚(pinned=false)时，回调必须复查，否则会把用户拉回底部并重新 pin 住（N1）。
    // 近底恢复：pinned 被误杀但视口仍贴近底部时也追（与条目数分支语义对齐），release=manual 除外。
    if (streamingBubbles.length > 0 && (pinnedRef.current || (releaseReasonRef.current !== 'manual' && scrollRef.current && isNearBottom(scrollRef.current, SCROLL_FOLLOW_THRESHOLD_PX)))) {
      requestAnimationFrame(() => {
        const element = scrollRef.current
        if (!element) return
        if (pinnedRef.current || (releaseReasonRef.current !== 'manual' && isNearBottom(element, SCROLL_FOLLOW_THRESHOLD_PX))) scrollToBottom()
      })
    }
  }, [allRenderItems.length, scrollToBottom, streamingBubbles.length, streamingSignature, scheduleScrollToBottom])
  const loadOlder = (): void => {
    if (adapter.hasMoreMessages && !adapter.loadingOlderMessages) {
      const element = scrollRef.current
      if (element) olderAnchorRef.current = { height: element.scrollHeight, top: element.scrollTop }
      void adapter.loadOlderMessages()
    }
  }
  // P2 兜底：解 pin 后（用户确实在看历史）提供一次性回到底部入口；宽限窗口覆盖平滑动画期间的
  // 中间滚动事件，避免动画途中被降级（落底后近底分支自然重新 pin 住）。
  const jumpToBottom = useCallback((): void => {
    // 用户显式要求回底 = 放弃定位锁，否则锁生效时 scrollToBottom 直接 return、按钮点不动。
    navigationLock.current = false
    pinnedRef.current = true
    releaseReasonRef.current = null
    initialLocateGraceRef.current = true
    window.clearTimeout(graceTimerRef.current)
    graceTimerRef.current = window.setTimeout(() => { initialLocateGraceRef.current = false }, INITIAL_LOCATE_GRACE_MS)
    setShowJumpToBottom(false)
    scrollToBottom('smooth')
  }, [scrollToBottom])
  return <div className="conversation-message-scroll-shell">
    <div className="conversation-message-scroll" ref={scrollRef} onScroll={(event) => { if (event.currentTarget.scrollTop <= 120) loadOlder() }}>
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
    {showJumpToBottom && <button type="button" className="conversation-jump-to-bottom" onClick={jumpToBottom} aria-label="回到底部" title="回到底部"><ArrowDown size={16} /></button>}
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
    {message.teamAssignment?.directed ? null : <TurnContentView
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
    />}
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
