import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowUp, Bot, User, AlertTriangle, WifiOff, Send } from 'lucide-react'
import { useConnectionStore } from '../../stores/connection.store'
import { useShareStore } from '../../stores/share.store'
import { wsClient } from '../../services/ws-client'
import { getOrCreateGuestId, getGuestName } from './guest-id'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'

interface GuestMessage {
  id: string
  role: string
  content: string
  sender_role: string | null
  sender_id: string | null
  sender_name: string | null
  timestamp: string
}

interface StreamingState {
  id: string
  content: string
  done: boolean
}

export default function GuestChatPage() {
  const { token = '' } = useParams<{ token: string }>()
  const init = useConnectionStore((s) => s.init)
  const connected = useConnectionStore((s) => s.connected)
  const bootstrapByToken = useShareStore((s) => s.bootstrapByToken)
  const recordVisit = useShareStore((s) => s.recordVisit)
  const currentShare = useShareStore((s) => s.currentShare)
  const loading = useShareStore((s) => s.loading)
  const error = useShareStore((s) => s.error)

  const [messages, setMessages] = useState<GuestMessage[]>([])
  const [streaming, setStreaming] = useState<StreamingState | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [showAgentIntro, setShowAgentIntro] = useState(true)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const scrollRef = useRef<HTMLDivElement>(null)
  const subscribedRef = useRef(false)
  const lastShareIdRef = useRef<string | null>(null)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (!token) return
    void bootstrapByToken(token)
    void recordVisit(token)
  }, [token, bootstrapByToken, recordVisit])

  useEffect(() => {
    if (!currentShare) return
    if (lastShareIdRef.current === currentShare.share.id) return
    lastShareIdRef.current = currentShare.share.id
    setMessages(
      currentShare.recentMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sender_role: m.sender_role,
        sender_id: m.sender_id,
        sender_name: m.sender_name,
        timestamp: m.timestamp,
      })),
    )
  }, [currentShare])

  useEffect(() => {
    if (!connected || !currentShare || subscribedRef.current) return
    subscribedRef.current = true
    wsClient.subscribe([currentShare.session.id])
  }, [connected, currentShare])

  useEffect(() => {
    const offUpdate = wsClient.on('session:update', (msg) => {
      if (!currentShare) return
      if (msg.sessionId !== currentShare.session.id) return
      const data = (msg.data ?? {}) as Record<string, unknown>
      const contentDelta = typeof data.contentDelta === 'string' ? data.contentDelta : ''
      const content = typeof data.content === 'string' ? data.content : ''
      const eventType = typeof data.eventType === 'string' ? data.eventType : ''
      if (eventType === 'lifecycle.started' || contentDelta || content) {
        setStreaming((prev) => {
          const id = msg.messageId ? String(msg.messageId) : prev?.id ?? `stream-${Date.now()}`
          const nextContent = content || (prev ? prev.content + contentDelta : contentDelta)
          return { id, content: nextContent, done: false }
        })
      }
    })
    const offDone = wsClient.on('session:done', (msg) => {
      if (!currentShare) return
      if (msg.sessionId !== currentShare.session.id) return
      setStreaming((prev) => (prev ? { ...prev, done: true } : null))
      const finalContent = typeof msg.finalAnswer === 'string' ? msg.finalAnswer : ''
      if (finalContent) {
        setMessages((prev) => [
          ...prev,
          {
            id: msg.messageId ? String(msg.messageId) : `agent-${Date.now()}`,
            role: 'agent',
            content: finalContent,
            sender_role: 'assistant',
            sender_id: currentShare.agent?.id ?? null,
            sender_name: currentShare.agent?.name ?? 'Agent',
            timestamp: new Date().toISOString(),
          },
        ])
      }
      setTimeout(() => setStreaming(null), 200)
    })
    return () => {
      offUpdate()
      offDone()
    }
  }, [currentShare])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const permission = currentShare?.share.permission ?? 'chat'
  const canChat = permission === 'chat'
  const expired = useMemo(() => {
    if (!currentShare?.share.expires_at) return false
    return new Date(currentShare.share.expires_at).getTime() < nowTick
  }, [currentShare, nowTick])

  const handleSend = () => {
    const v = inputValue.trim()
    if (!v || !canChat || !connected || !currentShare || expired) return
    const guestId = getOrCreateGuestId()
    const guestName = getGuestName()
    setMessages((prev) => [
      ...prev,
      {
        id: `guest-${Date.now()}`,
        role: 'human',
        content: v,
        sender_role: 'guest',
        sender_id: guestId,
        sender_name: guestName,
        timestamp: new Date().toISOString(),
      },
    ])
    wsClient.send({
      type: 'guest_prompt',
      shareToken: token,
      guestId,
      guestName,
      content: v,
    })
    setInputValue('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (loading && !currentShare) {
    return (
      <div style={styles.loadingWrap}>
        <Bot size={36} color="var(--text-3)" />
        <div style={{ marginTop: 12, color: 'var(--text-3)', fontSize: 14 }}>正在加载分享...</div>
      </div>
    )
  }

  if (error && !currentShare) {
    return (
      <div style={styles.loadingWrap}>
        <AlertTriangle size={36} color="var(--red)" />
        <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 15, fontWeight: 600 }}>分享不存在或已失效</div>
        <div style={{ marginTop: 6, color: 'var(--text-3)', fontSize: 13 }}>{error}</div>
      </div>
    )
  }

  if (!currentShare) return null

  const agentName = currentShare.agent?.name ?? 'Agent'
  const shareName = currentShare.share.share_name
  const remainingText = formatRemaining(currentShare.share.expires_at)

  return (
    <div style={styles.page}>
      <header style={styles.banner}>
        <div style={styles.bannerLeft}>
          <div style={styles.bannerAvatar}>
            <Bot size={18} color="white" />
          </div>
          <div>
            <div style={styles.bannerTitle}>{shareName}</div>
            <div style={styles.bannerMeta}>
              <span>{currentShare.agent?.name ?? '未知 Agent'} 分享</span>
              <span>·</span>
              <span style={{ color: 'var(--red)' }}>你是访客</span>
              {remainingText && <><span>·</span><span>{remainingText}</span></>}
            </div>
          </div>
        </div>
        <div style={styles.bannerRight}>
          <button type="button" onClick={() => setShowAgentIntro((v) => !v)} style={styles.bannerBtn}>
            <Bot size={13} /> Agent 介绍
          </button>
        </div>
      </header>

      {showAgentIntro && (
        <div style={styles.introCard}>
          <div style={styles.introAvatar}>
            <Bot size={20} color="white" />
          </div>
          <div style={styles.introBody}>
            <div style={styles.introTitle}>
              {agentName}
              <span style={styles.introType}>{currentShare.agent?.icon ?? 'agent'}</span>
            </div>
            <div style={styles.introText}>{currentShare.share.agent_intro}</div>
            <div style={styles.introMeta}>
              由 {currentShare.agent?.name ?? '未知'} 分享 · 创建于 {formatDate(currentShare.share.created_at)}
            </div>
          </div>
        </div>
      )}

      {!connected && (
        <div style={styles.offlineBar}>
          <WifiOff size={14} /> <span>分享者离线,请稍后再试</span>
        </div>
      )}
      {expired && (
        <div style={styles.expiredBar}>
          <AlertTriangle size={14} /> <span>此分享已过期</span>
        </div>
      )}

      <div ref={scrollRef} style={styles.chatArea}>
        {messages.length === 0 && !streaming && (
          <div style={styles.emptyHint}>暂无消息,开始对话吧</div>
        )}
        {messages.map((m) => (
          <GuestMessageBubble key={m.id} message={m} agentName={agentName} />
        ))}
        {streaming && !streaming.done && (
          <div style={styles.agentRow}>
            <div style={styles.agentAvatar}><Bot size={14} color="white" /></div>
            <div style={styles.agentBubble}>
              <MarkdownRenderer content={streaming.content || '生成中...'} />
            </div>
          </div>
        )}
      </div>

      <div style={styles.inputArea}>
        {canChat ? (
          <>
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`发消息给 ${agentName}...`}
              disabled={!connected || expired}
              rows={2}
              style={styles.textarea}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputValue.trim() || !connected || expired}
              style={{
                ...styles.sendBtn,
                background: inputValue.trim() && connected && !expired ? 'var(--blue)' : 'var(--bg-3)',
                cursor: inputValue.trim() && connected && !expired ? 'pointer' : 'default',
              }}
            >
              {streaming && !streaming.done ? <Send size={14} color="white" /> : <ArrowUp size={14} color="white" />}
            </button>
          </>
        ) : (
          <div style={styles.readonlyHint}>此分享为只读模式,无法发送消息</div>
        )}
        <div style={styles.footerTip}>你是访客 · 消息会显示给 owner 和 Agent</div>
      </div>
    </div>
  )
}

function GuestMessageBubble({ message, agentName }: { message: GuestMessage; agentName: string }) {
  const isAgent = message.role === 'agent' || message.sender_role === 'assistant'
  const isGuest = message.sender_role === 'guest'

  const avatar = isAgent ? (
    <div style={{ ...styles.avatar, background: 'var(--green)' }}><Bot size={14} color="white" /></div>
  ) : isGuest ? (
    <div style={{ ...styles.avatar, background: 'var(--red)' }}><User size={14} color="white" /></div>
  ) : (
    <div style={{ ...styles.avatar, background: 'var(--blue)' }}><User size={14} color="white" /></div>
  )

  const name = isAgent ? agentName : isGuest ? (message.sender_name ?? '访客') : (message.sender_name ?? 'owner')
  const tag = isAgent ? null : isGuest ? '访客' : 'owner'

  return (
    <div style={{ ...styles.msgRow, flexDirection: isAgent ? 'row' : 'row-reverse' }}>
      {avatar}
      <div style={{ maxWidth: '75%', minWidth: 0 }}>
        <div style={{ ...styles.msgHeader, flexDirection: isAgent ? 'row' : 'row-reverse' }}>
          <span style={styles.msgName}>{name}</span>
          {tag && <span style={styles.msgTag}>{tag}</span>}
          <span style={styles.msgTime}>{formatTime(message.timestamp)}</span>
        </div>
        <div style={{
          ...styles.msgBubble,
          background: isAgent ? 'var(--bg-0)' : isGuest ? 'var(--red-light, #fef2f2)' : 'var(--blue-light)',
          border: `1px solid ${isAgent ? 'var(--border)' : isGuest ? 'rgba(239,68,68,0.2)' : 'rgba(37,99,235,0.15)'}`,
        }}>
          <MarkdownRenderer content={message.content} />
        </div>
      </div>
    </div>
  )
}

function formatRemaining(expiresAt: string | null): string | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return '已过期'
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  if (hours >= 24) return `剩余 ${Math.floor(hours / 24)}d ${hours % 24}h`
  if (hours > 0) return `剩余 ${hours}h ${minutes}m`
  return `剩余 ${minutes}m`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-1)', minWidth: 0 },
  loadingWrap: { height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-1)' },
  banner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--bg-0)', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  bannerLeft: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  bannerAvatar: { width: 32, height: 32, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bannerTitle: { fontSize: 15, fontWeight: 600, color: 'var(--text-1)' },
  bannerMeta: { fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 },
  bannerRight: { display: 'flex', gap: 8 },
  bannerBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  introCard: { display: 'flex', gap: 12, padding: '14px 16px', margin: '12px 16px 0', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 10, flexShrink: 0 },
  introAvatar: { width: 40, height: 40, borderRadius: 8, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  introBody: { flex: 1, minWidth: 0 },
  introTitle: { fontSize: 14, fontWeight: 600, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 6 },
  introType: { fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-2)', color: 'var(--text-3)', fontWeight: 500 },
  introText: { fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 6 },
  introMeta: { fontSize: 11, color: 'var(--text-3)', marginTop: 8 },
  offlineBar: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 12, justifyContent: 'center' },
  expiredBar: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--red-light, #fef2f2)', color: 'var(--red)', fontSize: 12, justifyContent: 'center' },
  chatArea: { flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 },
  emptyHint: { textAlign: 'center', color: 'var(--text-3)', padding: '40px 0', fontSize: 14 },
  msgRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  avatar: { width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  msgHeader: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  msgName: { fontSize: 13, fontWeight: 600, color: 'var(--text-1)' },
  msgTag: { fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-2)', color: 'var(--text-3)', fontWeight: 500 },
  msgTime: { fontSize: 11, color: 'var(--text-3)' },
  msgBubble: { padding: '10px 12px', borderRadius: 10, fontSize: 14, lineHeight: 1.6, color: 'var(--text-1)', maxWidth: '100%', overflowWrap: 'anywhere' },
  agentRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  agentAvatar: { width: 30, height: 30, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  agentBubble: { padding: '10px 12px', borderRadius: '10px 2px 10px 10px', background: 'var(--bg-0)', border: '1px solid var(--border)', maxWidth: '75%', fontSize: 14, lineHeight: 1.6, color: 'var(--text-1)' },
  inputArea: { padding: '12px 16px 16px', background: 'var(--bg-0)', borderTop: '1px solid var(--border)', flexShrink: 0 },
  textarea: { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-1)', color: 'var(--text-1)', fontSize: 14, resize: 'none', outline: 'none', fontFamily: 'inherit', minHeight: 42, maxHeight: 120, boxSizing: 'border-box' },
  sendBtn: { position: 'absolute', right: 22, bottom: 30, width: 30, height: 30, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  readonlyHint: { padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 13, textAlign: 'center' },
  footerTip: { fontSize: 11, color: 'var(--text-3)', textAlign: 'center', marginTop: 8 },
}
