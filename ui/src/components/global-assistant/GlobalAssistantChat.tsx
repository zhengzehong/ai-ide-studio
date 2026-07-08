import { useCallback, useEffect, useMemo, useRef } from 'react'
import { MessageSquare, X } from 'lucide-react'
import {
  useGlobalAssistantStore,
  type GlobalAssistantPayload,
} from '../../stores/global-assistant.store'
import { buildChatRenderItems, type ChatRenderItem } from '../chat/render-items'
import { VirtualChatList } from '../chat/VirtualChatList'
import { isNearBottom, nextPinnedToBottom } from '../chat/auto-scroll'
import { shouldShowPlanBar } from '../chat/plan-visibility'
import { agentAvatar, agentColor, statusLabel } from '../../pages/workspace/helpers'
import { ICON_MAP } from '../agent-square/constants'
import { BlockingInteraction, GlobalChatBubble, TimelineGroupBubble } from './GlobalAssistantBubble'
import { CompactPlanBar } from './GlobalAssistantControls'
import { GlobalAssistantInput } from './GlobalAssistantInput'
import { InteractionPanel } from './GlobalAssistantInteractions'
import type { GlobalChatMsg } from './global-assistant.types'

export function GlobalAssistantChat({ connected, payload }: { connected: boolean; payload: GlobalAssistantPayload }) {
  const messages = useGlobalAssistantStore((state) => state.messages)
  const events = useGlobalAssistantStore((state) => state.events)
  const streamingMessage = useGlobalAssistantStore((state) => state.streamingMessage)
  const capabilities = useGlobalAssistantStore((state) => state.capabilities)
  const usage = useGlobalAssistantStore((state) => state.usage)
  const plan = useGlobalAssistantStore((state) => state.plan)
  const pendingPermissions = useGlobalAssistantStore((state) => state.pendingPermissions)
  const pendingElicitations = useGlobalAssistantStore((state) => state.pendingElicitations)
  const hasMoreMessages = useGlobalAssistantStore((state) => state.hasMoreMessages)
  const loadingOlderMessages = useGlobalAssistantStore((state) => state.loadingOlderMessages)
  const running = useGlobalAssistantStore((state) => state.running)
  const sendPrompt = useGlobalAssistantStore((state) => state.sendPrompt)
  const cancelTurn = useGlobalAssistantStore((state) => state.cancelTurn)
  const setModel = useGlobalAssistantStore((state) => state.setModel)
  const setMode = useGlobalAssistantStore((state) => state.setMode)
  const setConfig = useGlobalAssistantStore((state) => state.setConfig)
  const loadOlderMessages = useGlobalAssistantStore((state) => state.loadOlderMessages)
  const respondPermission = useGlobalAssistantStore((state) => state.respondPermission)
  const respondElicitation = useGlobalAssistantStore((state) => state.respondElicitation)
  const fetchMessageProcess = useGlobalAssistantStore((state) => state.fetchMessageProcess)
  const fetchMessageFileChanges = useGlobalAssistantStore((state) => state.fetchMessageFileChanges)
  const fetchProcessItemDetail = useGlobalAssistantStore((state) => state.fetchProcessItemDetail)
  const fileChangeDetailsByMessageId = useGlobalAssistantStore((state) => state.fileChangeDetailsByMessageId)
  const toolCallLoadingByKey = useGlobalAssistantStore((state) => state.toolCallLoadingByKey)
  const toolCallErrorByKey = useGlobalAssistantStore((state) => state.toolCallErrorByKey)
  const turnProcessLoadingByMessageId = useGlobalAssistantStore((state) => state.turnProcessLoadingByMessageId)
  const turnProcessErrorByMessageId = useGlobalAssistantStore((state) => state.turnProcessErrorByMessageId)
  const processItemLoadingByKey = useGlobalAssistantStore((state) => state.processItemLoadingByKey)
  const processItemErrorByKey = useGlobalAssistantStore((state) => state.processItemErrorByKey)
  const closeDrawer = useGlobalAssistantStore((state) => state.closeDrawer)
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const lastScrollHeightRef = useRef(0)

  const blockingInteraction = pendingPermissions.length > 0 || pendingElicitations.length > 0
  const isStreaming = running || !!(streamingMessage && !streamingMessage.done)
  const showPlan = shouldShowPlanBar({ plan, isStreaming, hasBlockingInteraction: blockingInteraction })

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (!el) {
      endRef.current?.scrollIntoView({ behavior })
      return
    }
    el.scrollTo({ top: el.scrollHeight, behavior })
    stickToBottomRef.current = true
    lastScrollHeightRef.current = el.scrollHeight
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop <= 120 && hasMoreMessages && !loadingOlderMessages) void loadOlderMessages()
    stickToBottomRef.current = nextPinnedToBottom({ wasPinned: stickToBottomRef.current, previousScrollHeight: lastScrollHeightRef.current, metrics: el })
    lastScrollHeightRef.current = el.scrollHeight
  }, [hasMoreMessages, loadOlderMessages, loadingOlderMessages])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    lastScrollHeightRef.current = el.scrollHeight
    stickToBottomRef.current = isNearBottom(el)
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => { el.removeEventListener('scroll', handleScroll) }
  }, [handleScroll])

  useEffect(() => {
    if (stickToBottomRef.current) requestAnimationFrame(() => scrollToBottom('auto'))
  }, [messages.length, streamingMessage?.content, streamingMessage?.processBlocks.length, scrollToBottom])

  const streamingBubble = useMemo<GlobalChatMsg | null>(() => {
    if (!streamingMessage || streamingMessage.done) return null
    return {
      id: streamingMessage.id,
      session_id: payload.session.id,
      role: 'agent',
      content: streamingMessage.content,
      thinking: streamingMessage.thinking,
      tool_calls_json: null,
      decision_json: null,
      attachments_json: null,
      file_changes_json: null,
      timestamp: new Date().toISOString(),
      toolCalls: streamingMessage.toolCalls,
      processBlocks: streamingMessage.processBlocks,
      finalAnswer: streamingMessage.finalAnswer,
      stage: streamingMessage.stage,
      streaming: true,
    }
  }, [payload.session.id, streamingMessage])

  const interactionPanel = useMemo(() => (
    blockingInteraction ? (
      <InteractionPanel
        permission={pendingPermissions[0]}
        elicitation={pendingPermissions.length === 0 ? pendingElicitations[0] : undefined}
        onRespondPermission={respondPermission}
        onRespondElicitation={respondElicitation}
      />
    ) : null
  ), [blockingInteraction, pendingElicitations, pendingPermissions, respondElicitation, respondPermission])

  const chatItems = useMemo(
    () => buildChatRenderItems<GlobalChatMsg>({
      sessionId: payload.session.id,
      messages,
      events,
      streamingBubble,
      showStreamingBubble: !!streamingBubble,
      blockingInteraction,
    }),
    [blockingInteraction, events, messages, payload.session.id, streamingBubble],
  )

  const renderItem = useCallback((item: ChatRenderItem<GlobalChatMsg>) => {
    if (item.kind === 'blocking') return <BlockingInteraction agentName={payload.agent.name} panel={interactionPanel} />
    if (item.kind === 'group') return <TimelineGroupBubble item={item.group} agentName={payload.agent.name} agentColorValue={agentColor(payload.agent)} />
    return (
      <GlobalChatBubble
        message={item.message}
        agentName={payload.agent.name}
        agentColorValue={agentColor(payload.agent)}
        isStreaming={item.kind === 'streaming'}
        footer={item.kind === 'streaming' ? interactionPanel : null}
        onLoadMessageProcess={fetchMessageProcess}
        onLoadMessageFileChanges={fetchMessageFileChanges}
        onLoadProcessItemDetail={fetchProcessItemDetail}
        fileChangeDetailsByMessageId={fileChangeDetailsByMessageId}
        fileChangeLoadingByKey={toolCallLoadingByKey}
        fileChangeErrorByKey={toolCallErrorByKey}
        processItemLoadingByKey={processItemLoadingByKey}
        processItemErrorByKey={processItemErrorByKey}
        turnProcessLoadingByMessageId={turnProcessLoadingByMessageId}
        turnProcessErrorByMessageId={turnProcessErrorByMessageId}
      />
    )
  }, [fetchMessageFileChanges, fetchMessageProcess, fetchProcessItemDetail, fileChangeDetailsByMessageId, interactionPanel, payload.agent, processItemErrorByKey, processItemLoadingByKey, toolCallErrorByKey, toolCallLoadingByKey, turnProcessErrorByMessageId, turnProcessLoadingByMessageId])

  return (
    <>
      <header className="global-assistant-header">
        <div className="global-assistant-title">
          <span className="global-assistant-title-avatar" style={{ background: agentColor(payload.agent), overflow: 'hidden' }}><GlobalAssistantTitleAvatar agent={payload.agent} size={36} /></span>
          <span>
            <strong>{payload.agent.name}</strong>
            <small>{payload.agent.runtime} · {statusLabel(payload.agent.status)}</small>
          </span>
        </div>
        <button type="button" className="global-assistant-icon-btn" onClick={closeDrawer} title="关闭">
          <X size={17} />
        </button>
      </header>
      {showPlan && <CompactPlanBar plan={plan} />}
      <div ref={scrollRef} className="global-assistant-scroll">
        {chatItems.length === 0 ? (
          <div className="global-assistant-empty-chat">
            <MessageSquare size={30} />
            <span>开始和全局助理对话</span>
          </div>
        ) : (
          <VirtualChatList items={chatItems} getKey={(item) => item.id} renderItem={renderItem} scrollRef={scrollRef} />
        )}
        <div ref={endRef} />
      </div>
      <GlobalAssistantInput
        connected={connected}
        blocked={blockingInteraction}
        streaming={isStreaming}
        capabilities={capabilities}
        usage={usage}
        onSend={sendPrompt}
        onCancel={() => { void cancelTurn() }}
        onSetModel={setModel}
        onSetMode={setMode}
        onSetConfig={setConfig}
      />
    </>
  )
}

function GlobalAssistantTitleAvatar({ agent, size }: { agent: { name: string; avatar_url?: string | null; icon?: string }; size: number }) {
  const result = agentAvatar(agent as never)
  if (result.kind === 'image') {
    return (
      <img
        src={result.src}
        alt={agent.name}
        style={{ width: size, height: size, objectFit: 'cover', borderRadius: 'inherit', display: 'block' }}
      />
    )
  }
  if (result.kind === 'icon') {
    const IconComp = ICON_MAP[result.name]
    if (IconComp) {
      return <IconComp size={Math.floor(size * 0.6)} color="white" />
    }
  }
  return <>{result.text}</>
}
