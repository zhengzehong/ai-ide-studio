import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Bot, Send } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import type { ProjectData } from '../../stores/project.store'
import { useSessionStore, type MessageData, type SessionData } from '../../stores/session.store'
import type { TaskData } from '../../stores/task.store'

export function SessionContext({
  session,
  agents,
  tasks,
  projects,
}: {
  session: SessionData | undefined
  agents: AgentData[]
  tasks: TaskData[]
  projects: ProjectData[]
}) {
  const currentSessionId = useSessionStore((state) => state.currentSessionId)
  const messages = useSessionStore((state) => state.messages)
  const streamingMessage = useSessionStore((state) => state.streamingMessage)
  const selectSession = useSessionStore((state) => state.selectSession)
  const fetchMessages = useSessionStore((state) => state.fetchMessages)
  const sendPrompt = useSessionStore((state) => state.sendPrompt)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!session) return
    if (currentSessionId !== session.id) selectSession(session.id)
    else void fetchMessages(session.id)
  }, [currentSessionId, fetchMessages, selectSession, session])

  const sessionMessages = useMemo(
    () => messages.filter((message) => message.session_id === session?.id),
    [messages, session?.id],
  )
  const agent = session ? agents.find((item) => item.id === session.agent_id) : null
  const task = session?.task_id ? tasks.find((item) => item.id === session.task_id) : null
  const project = session?.project_id ? projects.find((item) => item.id === session.project_id) : null
  const canSend = Boolean(draft.trim() && session && currentSessionId === session.id)

  if (!session) {
    return <div style={{ padding: 18, color: 'var(--text-3)', fontSize: 14 }}>未找到会话</div>
  }

  const handleSend = () => {
    const content = draft.trim()
    if (!content || currentSessionId !== session.id) return
    sendPrompt(content)
    setDraft('')
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: 14,
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bot size={15} color="var(--blue)" />
          <strong style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task?.title ?? session.title ?? session.id}
          </strong>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip>{agent?.name ?? session.agent_id}</Chip>
          <Chip>{project?.name ?? '未归属项目'}</Chip>
          <Chip>{session.activity_state ?? session.status}</Chip>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {sessionMessages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {streamingMessage && currentSessionId === session.id && (
          <div
            style={{
              alignSelf: 'stretch',
              border: '1px solid var(--blue-light)',
              borderRadius: 8,
              padding: 10,
              background: 'var(--blue-light)',
              color: 'var(--text-1)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {streamingMessage.content || streamingMessage.stage || 'Agent 正在处理...'}
          </div>
        )}
        {sessionMessages.length === 0 && !streamingMessage && (
          <div style={{ margin: 'auto', color: 'var(--text-3)', fontSize: 14, textAlign: 'center' }}>暂无消息</div>
        )}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleSend()
            }
          }}
          rows={2}
          placeholder="继续这段会话..."
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg-1)',
            color: 'var(--text-1)',
            padding: '8px 10px',
            outline: 'none',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        />
        <button
          type="button"
          disabled={!canSend}
          onClick={handleSend}
          style={{ ...primaryButtonStyle, alignSelf: 'end', opacity: canSend ? 1 : 0.55 }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: MessageData }) {
  const isHuman = message.role === 'human'
  return (
    <div
      style={{
        maxWidth: '92%',
        alignSelf: isHuman ? 'flex-end' : 'flex-start',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: isHuman ? 'var(--blue)' : 'var(--bg-1)',
        color: isHuman ? 'white' : 'var(--text-1)',
        padding: '8px 10px',
        fontSize: 13,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      {message.content || (message.has_tool_calls ? '工具调用' : '空消息')}
    </div>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        border: '1px solid var(--border)',
        borderRadius: 999,
        padding: '2px 8px',
        color: 'var(--text-2)',
        background: 'var(--bg-1)',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  )
}

const primaryButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  border: 'none',
  borderRadius: 8,
  background: 'var(--blue)',
  color: 'white',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}
