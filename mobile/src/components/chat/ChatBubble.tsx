import { memo, type CSSProperties, type ReactNode } from 'react'
import { User, Bot } from 'lucide-react'
import { agentGradient } from '../../theme'

interface Props {
  role: 'human' | 'agent'
  /** agent 头像渐变取色;缺省回退中性渐变 */
  agentId?: string | null
  children: ReactNode
}

// memo: children 由父组件控制,通常稳定;但当父组件把 message/streaming
// 作为 props 直接传入(而非 children JSX)时,memo 才能真正跳过重渲染。
// 这里保留 memo 以覆盖 human 消息(纯文本 children)和未来可能的稳定传入。
function ChatBubbleBase({ role, agentId, children }: Props) {
  const isHuman = role === 'human'
  const [from, to] = agentGradient(agentId || 'agent')

  return (
    <div style={{ ...styles.row, flexDirection: isHuman ? 'row-reverse' : 'row' }}>
      <div style={isHuman ? styles.avatar : { ...styles.avatar, background: `linear-gradient(135deg, ${from}, ${to})` }}>
        {isHuman
          ? <User size={16} color="var(--primary)" />
          : <Bot size={16} color="#fff" />}
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
    maxWidth: '88%',
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
    borderRadius: '4px var(--radius) var(--radius) var(--radius)',
    border: '1px solid var(--border-light)',
    boxShadow: 'var(--shadow-card)',
  },
}
