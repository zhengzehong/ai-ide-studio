import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bot } from 'lucide-react'
import { buildChatRenderItems } from '@desktop/components/chat/render-items'
import type { ChatTimelineGroup, MessageData, StreamingMessage } from '@desktop/stores/session-events'
import { useChatStore } from '../stores/chat.store'
import { useSessionStore } from '../stores/session.store'
import ChatBubble from '../components/chat/ChatBubble'
import ChatInput from '../components/chat/ChatInput'
import TurnContent from '../components/chat/TurnContent'
import PlanBar from '../components/chat/PlanBar'
import PermissionCard from '../components/chat/PermissionCard'
import ElicitationCard from '../components/chat/ElicitationCard'
import { deriveLiveElapsedSeconds } from '../utils/chat-elapsed'

type MobileChatMessage = MessageData | (StreamingMessage & { session_id?: string })

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const listRef = useRef<HTMLDivElement>(null)
  const {
    messages, events, streamingMessage, loading, isRunning, plan, pendingPermissions, pendingElicitations, capabilities,
    turnProcessLoadingByMessageId, turnProcessErrorByMessageId,
    enterSession, leaveSession, sendPrompt, cancelTurn, fetchMessageProcess, respondPermission, respondElicitation,
  } = useChatStore()
  const sessions = useSessionStore(s => s.sessions)
  const session = sessions.find(s => s.id === sessionId)
  const listenersRef = useRef(false)
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!sessionId) return
    useSessionStore.getState().setCurrentSession(sessionId)
    enterSession(sessionId)
    useSessionStore.getState().markRead(sessionId)
    if (!listenersRef.current) {
      listenersRef.current = true
      const off = useChatStore.getState().setupListeners()
      return () => {
        off()
        listenersRef.current = false
        leaveSession()
        useSessionStore.getState().setCurrentSession(null)
      }
    }
    return () => {
      leaveSession()
      useSessionStore.getState().setCurrentSession(null)
    }
  }, [sessionId])

  const hasBlockingInteraction = pendingPermissions.length > 0 || pendingElicitations.length > 0
  useEffect(() => {
    if (!isRunning) return undefined
    setLiveNowMs(Date.now())
    const timer = window.setInterval(() => setLiveNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isRunning, sessionId])

  const liveElapsedSeconds = useMemo(() => deriveLiveElapsedSeconds({
    isRunning,
    sessionId,
    nowMs: liveNowMs,
    messages,
  }), [isRunning, liveNowMs, messages, sessionId])

  const chatItems = useMemo(() => buildChatRenderItems<MobileChatMessage>({
    sessionId: sessionId ?? null,
    messages,
    events,
    streamingBubble: streamingMessage ? { ...streamingMessage, session_id: sessionId } : null,
    showStreamingBubble: !!streamingMessage,
    blockingInteraction: hasBlockingInteraction,
  }), [events, hasBlockingInteraction, messages, sessionId, streamingMessage])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [chatItems, pendingPermissions, pendingElicitations])

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>
        <div style={styles.headerInfo}>
          <span style={styles.headerTitle}>{session?.sessionTitle || session?.agentName || '对话'}</span>
          {session && (
            <span style={styles.headerSub}>
              <Bot size={11} style={{ marginRight: 3 }} />
              {session.agentName}
            </span>
          )}
        </div>
        {isRunning && <span style={styles.runningDot} />}
      </div>

      {plan.length > 0 && <PlanBar plan={plan} />}

      <div ref={listRef} style={styles.messages}>
        {loading && (
          <div style={styles.loadingWrap}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>加载中...</span>
          </div>
        )}
        {chatItems.map((item) => {
          if (item.kind === 'message') {
            const msg = item.message as MessageData
            return (
              <ChatBubble key={item.id} role={msg.role === 'human' ? 'human' : 'agent'}>
                {msg.role === 'agent' ? (
                  <TurnContent
                    message={msg}
                    processLoading={!!turnProcessLoadingByMessageId[msg.id]}
                    processError={turnProcessErrorByMessageId[msg.id]}
                    onLoadProcess={fetchMessageProcess}
                  />
                ) : (
                  <span>{msg.content}</span>
                )}
              </ChatBubble>
            )
          }
          if (item.kind === 'streaming') {
            return (
              <ChatBubble key={item.id} role="agent">
                <TurnContent streaming={item.message as StreamingMessage} liveElapsedSeconds={liveElapsedSeconds} />
              </ChatBubble>
            )
          }
          if (item.kind === 'group') {
            return (
              <ChatBubble key={item.id} role={item.group.role === 'human' ? 'human' : 'agent'}>
                <TimelineGroupContent group={item.group} />
              </ChatBubble>
            )
          }
          return null
        })}

        {pendingPermissions.map(p => (
          <PermissionCard
            key={p.id}
            request={p}
            onRespond={(optionId, cancelled) => respondPermission(p.id, optionId, cancelled)}
          />
        ))}
        {pendingElicitations.map(e => (
          <ElicitationCard
            key={e.id}
            request={e}
            onRespond={(action, content) => respondElicitation(e.id, action, content)}
          />
        ))}
      </div>

      <ChatInput
        onSend={sendPrompt}
        onCancel={cancelTurn}
        isRunning={isRunning}
        disabled={hasBlockingInteraction}
        disabledPlaceholder="等待确认..."
        supportsImages={capabilities.supportsImages}
      />
    </div>
  )
}

function TimelineGroupContent({ group }: { group: ChatTimelineGroup }) {
  return (
    <div style={styles.timelineGroup}>
      {group.blocks.map((block) => {
        if (block.kind === 'message') {
          return <div key={block.id}>{block.content}</div>
        }
        return <div key={block.id} style={styles.timelineTool}>{block.toolCall.title || '工具调用'}</div>
      })}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    paddingTop: 'calc(10px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  backBtn: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    display: 'block',
    fontSize: 16,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerSub: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    color: 'var(--text-muted)',
    marginTop: 1,
  },
  runningDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--success)',
    flexShrink: 0,
    animation: 'pulse 1.5s infinite',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 0',
  },
  loadingWrap: {
    display: 'flex',
    justifyContent: 'center',
    padding: 20,
  },
  timelineGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  timelineTool: {
    fontSize: 12,
    color: 'var(--text-muted)',
  },
}
