import { useEffect, useRef, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bot } from 'lucide-react'
import { useChatStore } from '../stores/chat.store'
import { useSessionStore } from '../stores/session.store'
import ChatBubble from '../components/chat/ChatBubble'
import ChatInput from '../components/chat/ChatInput'
import TurnContent from '../components/chat/TurnContent'
import PlanBar from '../components/chat/PlanBar'
import PermissionCard from '../components/chat/PermissionCard'
import ElicitationCard from '../components/chat/ElicitationCard'

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const listRef = useRef<HTMLDivElement>(null)
  const { messages, streamingMessage, loading, isRunning, plan, pendingPermissions, pendingElicitations, capabilities,
    enterSession, leaveSession, sendPrompt, cancelTurn, respondPermission, respondElicitation } = useChatStore()
  const sessions = useSessionStore(s => s.sessions)
  const session = sessions.find(s => s.sessionId === sessionId)
  const listenersRef = useRef(false)

  useEffect(() => {
    if (!sessionId) return
    enterSession(sessionId)
    useSessionStore.getState().markRead(sessionId)
    if (!listenersRef.current) {
      listenersRef.current = true
      const off = useChatStore.getState().setupListeners()
      return () => { off(); listenersRef.current = false; leaveSession() }
    }
    return () => leaveSession()
  }, [sessionId])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, streamingMessage])

  const hasBlockingInteraction = pendingPermissions.length > 0 || pendingElicitations.length > 0

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
        {messages.map((msg) => (
          <ChatBubble key={msg.id} role={msg.role as 'human' | 'agent'}>
            {msg.role === 'agent' ? (
              <TurnContent message={msg} />
            ) : (
              <span>{msg.content}</span>
            )}
          </ChatBubble>
        ))}
        {streamingMessage && (
          <ChatBubble role="agent">
            <TurnContent streaming={streamingMessage} />
          </ChatBubble>
        )}

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
}
