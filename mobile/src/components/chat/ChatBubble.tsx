import type { CSSProperties, ReactNode } from 'react'
import { User, Bot } from 'lucide-react'

interface Props {
  role: 'human' | 'agent'
  children: ReactNode
}

export default function ChatBubble({ role, children }: Props) {
  const isHuman = role === 'human'

  return (
    <div style={{ ...styles.row, flexDirection: isHuman ? 'row-reverse' : 'row' }}>
      <div style={{ ...styles.avatar, background: isHuman ? 'var(--primary-bg)' : '#f0fdf4' }}>
        {isHuman
          ? <User size={16} color="var(--primary)" />
          : <Bot size={16} color="var(--success)" />}
      </div>
      <div style={{ ...styles.bubble, ...(isHuman ? styles.humanBubble : styles.agentBubble) }}>
        {children}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    padding: '6px 16px',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  bubble: {
    maxWidth: '80%',
    padding: '10px 14px',
    borderRadius: 'var(--radius)',
    fontSize: 14,
    lineHeight: 1.6,
    wordBreak: 'break-word',
  },
  humanBubble: {
    background: 'var(--primary)',
    color: '#fff',
    borderTopRightRadius: 4,
  },
  agentBubble: {
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    borderTopLeftRadius: 4,
    border: '1px solid var(--border-light)',
  },
}
