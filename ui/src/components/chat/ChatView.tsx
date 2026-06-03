import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Bot, ChevronDown, ChevronRight, Send, User } from 'lucide-react'
import type { Agent, AgentType, ChatMessage, Session, ToolCall } from '../../types'

const c = {
  bg0: '#0a0e14',
  bg1: '#0d1117',
  bg2: '#161b22',
  bg3: '#21262d',
  bg4: '#30363d',
  border: '#262c36',
  text1: '#e6edf3',
  text2: '#8b949e',
  text3: '#6e7681',
  blue: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#bc8cff',
  orange: '#f0883e',
} as const

const AGENT_COLORS: Record<AgentType, string> = {
  dev: c.blue,
  test: c.green,
  ops: c.orange,
  security: c.red,
  architect: c.purple,
  pm: c.purple,
}

interface ChatViewProps {
  messages: ChatMessage[]
  currentAgent: Agent
  currentSession?: Session
  onSend: (message: string) => void
  onDecision: (messageId: string, option: string) => void
}

function agentColor(agent: Agent): string {
  return AGENT_COLORS[agent.type] ?? c.blue
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function ToolCallBlock({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const statusIcon = tool.status === 'done' ? '✅' : tool.status === 'error' ? '❌' : '⏳'
  const borderColor = tool.status === 'done' ? c.green : tool.status === 'error' ? c.red : c.yellow

  return (
    <div
      style={{
        fontSize: 13,
        fontFamily: 'ui-monospace, monospace',
        background: c.bg3,
        borderRadius: 4,
        padding: '6px 8px',
        borderLeft: `2px solid ${borderColor}`,
        cursor: tool.result ? 'pointer' : 'default',
      }}
      onClick={() => tool.result && setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{statusIcon}</span>
        <span style={{ color: c.blue, fontWeight: 600 }}>{tool.name}</span>
        <span style={{ color: c.text3, fontSize: 12 }}>
          {!expanded && tool.result ? `→ ${tool.result.slice(0, 60)}…` : ''}
        </span>
        {tool.result && (
          <span style={{ marginLeft: 'auto', color: c.text3 }}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </div>
      {expanded && tool.result && (
        <div
          style={{
            marginTop: 6,
            padding: '6px 8px',
            background: c.bg0,
            borderRadius: 4,
            color: c.text2,
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {tool.result}
        </div>
      )}
      <div style={{ marginTop: 4, fontSize: 12, color: c.text3 }}>
        {tool.args}
      </div>
    </div>
  )
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      style={{
        marginTop: 8,
        borderRadius: 6,
        border: `1px solid ${c.border}`,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          padding: '6px 10px',
          border: 'none',
          background: c.bg3,
          color: c.text3,
          fontSize: 13,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          textAlign: 'left',
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        💭 思考过程
      </button>
      {expanded && (
        <div
          style={{
            padding: '8px 12px',
            background: c.bg2,
            color: c.text2,
            fontSize: 14,
            fontStyle: 'italic',
            lineHeight: 1.6,
          }}
        >
          {thinking}
        </div>
      )}
    </div>
  )
}

function DecisionBlock({
  messageId,
  decision,
  onDecision,
}: {
  messageId: string
  decision: NonNullable<ChatMessage['decision']>
  onDecision: (messageId: string, option: string) => void
}) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: 12,
        background: c.bg3,
        borderRadius: 8,
        border: `1px solid ${c.border}`,
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: c.yellow,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        ⚡ {decision.question}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {decision.options.map((option) => {
          const isChosen = decision.chosen === option
          return (
            <button
              key={option}
              type="button"
              onClick={() => !decision.chosen && onDecision(messageId, option)}
              disabled={!!decision.chosen && !isChosen}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: `1px solid ${isChosen ? c.blue : c.border}`,
                background: isChosen ? 'rgba(88, 166, 255, 0.12)' : c.bg2,
                color: isChosen ? c.blue : decision.chosen ? c.text3 : c.text1,
                fontSize: 14,
                cursor: decision.chosen ? 'default' : 'pointer',
                fontWeight: isChosen ? 600 : 400,
                opacity: decision.chosen && !isChosen ? 0.5 : 1,
              }}
            >
              {isChosen && '✓ '}{option}
            </button>
          )
        })}
      </div>
      {decision.chosen && (
        <div style={{ marginTop: 8, fontSize: 13, color: c.green }}>
          ✅ 决策记录: {decision.chosen}
          <span style={{ color: c.text3, marginLeft: 8 }}>
            由 {decision.decidedBy === 'human' ? '用户' : 'Agent'} 决定
          </span>
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  message,
  agent,
  onDecision,
}: {
  message: ChatMessage
  agent: Agent
  onDecision: (messageId: string, option: string) => void
}) {
  if (message.role === 'system') {
    return (
      <div
        style={{
          textAlign: 'center',
          fontSize: 13,
          color: c.text3,
          padding: '8px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div style={{ flex: 1, height: 1, background: c.border }} />
        <span>📋 {message.content}</span>
        <div style={{ flex: 1, height: 1, background: c.border }} />
      </div>
    )
  }

  const isHuman = message.role === 'human'

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        flexDirection: isHuman ? 'row-reverse' : 'row',
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: isHuman ? c.bg4 : agentColor(agent),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isHuman ? <User size={14} color={c.text2} /> : <Bot size={14} color={c.bg0} />}
      </div>

      <div style={{ maxWidth: '78%', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
            flexDirection: isHuman ? 'row-reverse' : 'row',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: c.text1 }}>
            {isHuman ? '你' : agent.name}
          </span>
          <span style={{ fontSize: 12, color: c.text3 }}>
            {formatTime(message.timestamp)}
          </span>
          {message.sessionId && !isHuman && (
            <span
              style={{
                fontSize: 11,
                fontFamily: 'ui-monospace, monospace',
                color: c.text3,
                background: c.bg4,
                padding: '1px 5px',
                borderRadius: 3,
              }}
            >
              {message.sessionId.replace('sess-', 'S-')}
            </span>
          )}
        </div>

        <div
          style={{
            padding: '10px 14px',
            borderRadius: isHuman ? '10px 2px 10px 10px' : '2px 10px 10px 10px',
            background: isHuman ? 'rgba(88, 166, 255, 0.08)' : c.bg2,
            border: `1px solid ${isHuman ? 'rgba(88, 166, 255, 0.2)' : c.border}`,
          }}
        >
          {message.thinking && <ThinkingBlock thinking={message.thinking} />}

          {message.toolCalls && message.toolCalls.length > 0 && (
            <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {message.toolCalls.map((tc, i) => (
                <ToolCallBlock key={i} tool={tc} />
              ))}
            </div>
          )}

          <div style={{ fontSize: 15, lineHeight: 1.6, color: c.text1 }}>
            {message.content}
          </div>

          {message.decision && (
            <DecisionBlock
              messageId={message.id}
              decision={message.decision}
              onDecision={onDecision}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function ChatView({
  messages,
  currentAgent,
  currentSession,
  onSend,
  onDecision,
}: ChatViewProps) {
  const [inputValue, setInputValue] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    onSend(trimmed)
    setInputValue('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const sessionTag = currentSession
    ? currentSession.id.replace('sess-', 'S-')
    : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        className="ws-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: c.text3, padding: '40px 0', fontSize: 15 }}>
            暂无消息，开始与 {currentAgent.name} 对话
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              agent={currentAgent}
              onDecision={onDecision}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div
        style={{
          padding: '12px 16px',
          borderTop: `1px solid ${c.border}`,
          background: c.bg1,
          display: 'flex',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`跟 ${currentAgent.name} 说话...${sessionTag ? ` (→ ${sessionTag})` : ''}`}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${c.border}`,
            background: c.bg2,
            color: c.text1,
            fontSize: 15,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: c.blue,
            color: c.bg0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          <Send size={16} />
          发送
        </button>
      </div>
    </div>
  )
}
