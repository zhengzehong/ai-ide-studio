import { memo, type CSSProperties, type ReactNode } from 'react'
import { User, Bot } from 'lucide-react'

interface Props {
  role: 'human' | 'agent'
  children: ReactNode
}

// memo: children 由父组件控制,通常稳定;但当父组件把 message/streaming
// 作为 props 直接传入(而非 children JSX)时,memo 才能真正跳过重渲染。
// 这里保留 memo 以覆盖 human 消息(纯文本 children)和未来可能的稳定传入。
function ChatBubbleBase({ role, children }: Props) {
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

const ChatBubble = memo(ChatBubbleBase)
export default ChatBubble

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
