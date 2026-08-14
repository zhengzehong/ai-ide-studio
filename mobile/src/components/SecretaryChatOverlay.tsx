import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Loader2, Send, X } from 'lucide-react'
import { wsClient } from '@desktop/services/ws-client'

interface Message { id: string; role: string; content: string }

export default function SecretaryChatOverlay({ projectId, secretaryId, sessionId, onClose }: { projectId: string; secretaryId: string; sessionId: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    try { setMessages(await wsClient.request({ type: 'sessions.messages', sessionId, limit: 100 }) as Message[]); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '对话加载失败') }
    finally { setLoading(false) }
  }, [sessionId])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])
  const send = async (): Promise<void> => {
    const content = text.trim()
    if (!content || sending) return
    setText(''); setSending(true)
    try { await wsClient.request({ type: 'secretary.chat.send', projectId, secretaryId, content }); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '发送失败') }
    finally { setSending(false) }
  }
  return <div style={styles.overlay}><section style={styles.panel}><header style={styles.header}><strong>秘书对话</strong><button type="button" onClick={onClose} aria-label="关闭" style={styles.close}><X size={20} /></button></header><div style={styles.messages}>{loading ? <div style={styles.state}><Loader2 size={17} /> 正在加载...</div> : messages.map((message) => <div key={message.id} style={{ ...styles.message, ...(message.role === 'user' ? styles.user : {}) }}><small>{message.role === 'user' ? '你' : '秘书'}</small><div>{message.content}</div></div>)}</div>{error && <div style={styles.error}>{error}</div>}<footer style={styles.footer}><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="告诉秘书你的要求" /><button type="button" onClick={() => void send()} disabled={sending} aria-label="发送" style={styles.send}>{sending ? <Loader2 size={16} /> : <Send size={16} />}</button></footer></section></div>
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1300, background: 'var(--bg)', display: 'flex', flexDirection: 'column' },
  panel: { height: '100%', display: 'flex', flexDirection: 'column' },
  header: { minHeight: 52, padding: 'calc(8px + var(--safe-top)) 12px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)' },
  close: { width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', color: 'var(--text-primary)' },
  messages: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 9 },
  message: { alignSelf: 'flex-start', maxWidth: '88%', padding: '8px 10px', borderRadius: 7, background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13 },
  user: { alignSelf: 'flex-end', background: 'var(--primary-light)', color: 'var(--text-primary)' },
  state: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-muted)' },
  footer: { display: 'flex', gap: 7, padding: '9px 11px calc(9px + var(--safe-bottom))', background: 'var(--bg-card)', borderTop: '1px solid var(--border-light)' },
  send: { width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 6, background: 'var(--primary)', color: '#fff' },
  error: { padding: '6px 11px', color: 'var(--error)', fontSize: 11 },
}
