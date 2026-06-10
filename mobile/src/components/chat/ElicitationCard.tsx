import { useState, type CSSProperties, type FormEvent } from 'react'
import { MessageCircleQuestion, Send, X } from 'lucide-react'
import type { ElicitationRequestInfo } from '@desktop/stores/session-events'

interface Props {
  request: ElicitationRequestInfo
  onRespond: (action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => void
}

export default function ElicitationCard({ request, onRespond }: Props) {
  const [text, setText] = useState('')

  if (request.resolved) return null

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    onRespond('accept', { response: text.trim() })
  }

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <MessageCircleQuestion size={18} color="var(--info)" />
        <span style={styles.title}>AI 提问</span>
      </div>

      {request.message && (
        <div style={styles.message}>{request.message}</div>
      )}

      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          style={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入回答..."
          autoFocus
        />
        <button type="submit" style={styles.sendBtn} disabled={!text.trim()}>
          <Send size={14} color="#fff" />
        </button>
      </form>

      <div style={styles.actions}>
        <button style={styles.declineBtn} onClick={() => onRespond('decline')}>跳过</button>
        <button style={styles.cancelBtn} onClick={() => onRespond('cancel')}>
          <X size={14} /> 取消
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    margin: '8px 16px',
    padding: 14,
    borderRadius: 'var(--radius)',
    background: '#eff6ff',
    border: '1px solid #93c5fd',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  message: {
    fontSize: 14,
    color: 'var(--text-primary)',
    lineHeight: 1.6,
    marginBottom: 10,
  },
  form: {
    display: 'flex',
    gap: 8,
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    fontSize: 14,
    outline: 'none',
    background: '#fff',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'var(--info)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
  },
  declineBtn: {
    padding: '6px 14px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-input)',
    color: 'var(--text-secondary)',
    fontSize: 13,
  },
  cancelBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 14px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-input)',
    color: 'var(--text-muted)',
    fontSize: 13,
  },
}
