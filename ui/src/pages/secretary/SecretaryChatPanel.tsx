import { useCallback, useEffect, useState } from 'react'
import { Loader2, Send, X } from 'lucide-react'
import { wsClient } from '../../services/ws-client'

interface ChatMessage { id: string; role: string; content: string; timestamp?: string }

export function SecretaryChatPanel({ projectId, secretaryId, sessionId, onClose }: { projectId: string; secretaryId: string; sessionId: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await wsClient.request({ type: 'sessions.messages', sessionId, limit: 100 }) as ChatMessage[]
      setMessages(data)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '对话加载失败')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])

  const send = async (): Promise<void> => {
    const text = content.trim()
    if (!text || sending) return
    setSending(true)
    setContent('')
    try {
      await wsClient.request({ type: 'secretary.chat.send', projectId, secretaryId, content: text })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '消息发送失败')
    } finally {
      setSending(false)
    }
  }

  return <div style={styles.overlay}><aside style={styles.panel}><header style={styles.header}><strong>秘书对话</strong><button type="button" onClick={onClose} aria-label="关闭" style={styles.close}><X size={17} /></button></header><div style={styles.messages}>{loading ? <div style={styles.state}><Loader2 size={18} /> 正在加载...</div> : messages.length === 0 ? <div style={styles.state}>从这里告诉秘书你希望它怎么工作。</div> : messages.map((message) => <div key={message.id} style={{ ...styles.message, ...(message.role === 'user' ? styles.user : {}) }}><span>{message.role === 'user' ? '你' : '秘书'}</span><p>{message.content}</p></div>)}</div>{error && <div style={styles.error}>{error}</div>}<footer style={styles.footer}><textarea value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="告诉秘书你的要求" /><button type="button" disabled={sending} onClick={() => void send()} aria-label="发送" style={styles.send}>{sending ? <Loader2 size={16} /> : <Send size={16} />}</button></footer></aside></div>
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1700, display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,23,42,.22)' },
  panel: { width: 'min(440px, 100%)', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-0)', boxShadow: '-12px 0 40px rgba(15,23,42,.18)' },
  header: { minHeight: 52, padding: '0 14px 0 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' },
  close: { width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', color: 'var(--text-2)' },
  messages: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  message: { maxWidth: '88%', alignSelf: 'flex-start', padding: '8px 10px', borderRadius: 7, background: 'var(--bg-1)', color: 'var(--text-2)', fontSize: 13 },
  user: { alignSelf: 'flex-end', background: 'var(--blue-light)', color: 'var(--text-1)' },
  state: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, color: 'var(--text-3)', fontSize: 12 },
  footer: { display: 'flex', gap: 7, padding: 12, borderTop: '1px solid var(--border)' },
  send: { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 6, background: 'var(--blue)', color: '#fff' },
  error: { padding: '7px 12px', color: 'var(--red)', fontSize: 11 },
}
