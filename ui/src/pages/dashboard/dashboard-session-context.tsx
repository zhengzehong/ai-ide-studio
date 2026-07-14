import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Send } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import type { ProjectData } from '../../stores/project.store'
import { useSessionStore, type MessageData, type SessionData } from '../../stores/session.store'
import type { TaskData } from '../../stores/task.store'
import { wsClient } from '../../services/ws-client'

interface LocalStreamingState {
  id: string
  content: string
}

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
  // 不再使用 store 的 currentSessionId/streamingMessage/selectSession/sendPrompt
  // 改用本地 state,避免污染 Workspace 的 currentSessionId
  const [localMessages, setLocalMessages] = useState<MessageData[]>([])
  const [localStreaming, setLocalStreaming] = useState<LocalStreamingState | null>(null)
  const [draft, setDraft] = useState('')
  const subscribedRef = useRef(false)
  const lastSessionIdRef = useRef<string | null>(null)
  const streamingRef = useRef<LocalStreamingState | null>(null)

  useEffect(() => {
    streamingRef.current = localStreaming
  }, [localStreaming])

  const sessionId = session?.id ?? null

  // session 变化时重置本地 state,拉取最新消息
  useEffect(() => {
    if (!sessionId) {
      setLocalMessages([])
      setLocalStreaming(null)
      lastSessionIdRef.current = null
      return
    }
    if (lastSessionIdRef.current === sessionId) return
    lastSessionIdRef.current = sessionId
    setLocalMessages([])
    setLocalStreaming(null)
    void (async () => {
      try {
        const serverMessages = (await wsClient.request({
          type: 'sessions.messages',
          sessionId,
          limit: 20,
        })) as MessageData[]
        if (lastSessionIdRef.current !== sessionId) return
        setLocalMessages(serverMessages)
      } catch {
        // ignore; user can retry by switching
      }
    })()
  }, [sessionId])

  // 订阅 session 的 WS 推送(本地处理,不影响 store)
  useEffect(() => {
    if (!sessionId) return
    // 订阅当前 session 以接收推送(wsClient 维护订阅集合,不会与 store 的订阅冲突)
    wsClient.subscribe([sessionId])
    subscribedRef.current = true

    const offUpdate = wsClient.on('session:update', (msg) => {
      if (msg.sessionId !== sessionId) return
      const data = (msg.data ?? {}) as Record<string, unknown>
      const contentDelta = typeof data.contentDelta === 'string' ? data.contentDelta : ''
      const content = typeof data.content === 'string' ? data.content : ''
      const eventType = typeof data.eventType === 'string' ? data.eventType : ''
      if (eventType === 'lifecycle.started' || contentDelta || content) {
        setLocalStreaming((prev) => {
          const id = msg.messageId ? String(msg.messageId) : prev?.id ?? `stream-${Date.now()}`
          const nextContent = content || (prev ? prev.content + contentDelta : contentDelta)
          return { id, content: nextContent }
        })
      }
    })

    const offEvent = wsClient.on('session:event', (msg) => {
      if (msg.sessionId !== sessionId) return
      const event = (msg.event ?? {}) as Record<string, unknown>
      const type = typeof event.type === 'string' ? event.type : ''
      const payload = (event.payload ?? {}) as Record<string, unknown>
      const messageId = typeof event.message_id === 'string'
        ? event.message_id
        : typeof payload.messageId === 'string'
          ? payload.messageId
          : `evt-${typeof event.id === 'string' ? event.id : Date.now()}`
      if (type === 'message.user') {
        const content = typeof payload.content === 'string' ? payload.content : ''
        const ts = typeof event.created_at === 'string' ? event.created_at : new Date().toISOString()
        setLocalMessages((prev) => {
          if (prev.some((m) => m.id === messageId)) return prev
          return [
            ...prev,
            {
              id: messageId,
              session_id: sessionId,
              role: 'human',
              content,
              thinking: null,
              tool_calls_json: null,
              decision_json: null,
              timestamp: ts,
            },
          ]
        })
      }
    })

    const offDone = wsClient.on('session:done', (msg) => {
      if (msg.sessionId !== sessionId) return
      const finalContent = streamingRef.current?.content ?? ''
      const finalId = streamingRef.current?.id ?? (msg.messageId ? String(msg.messageId) : `agent-${Date.now()}`)
      if (finalContent) {
        setLocalMessages((prev) => {
          if (prev.some((m) => m.id === finalId)) return prev
          return [
            ...prev,
            {
              id: finalId,
              session_id: sessionId,
              role: 'agent',
              content: finalContent,
              thinking: null,
              tool_calls_json: null,
              decision_json: null,
              timestamp: new Date().toISOString(),
            },
          ]
        })
      }
      setLocalStreaming(null)
    })

    return () => {
      offUpdate()
      offEvent()
      offDone()
    }
  }, [sessionId])

  const sessionMessages = useMemo(() => localMessages, [localMessages])
  const agent = session ? agents.find((item) => item.id === session.agent_id) : null
  const task = session?.task_id ? tasks.find((item) => item.id === session.task_id) : null
  const project = session?.project_id ? projects.find((item) => item.id === session.project_id) : null
  const canSend = Boolean(draft.trim() && session)

  if (!session) {
    return <div style={{ padding: 18, color: 'var(--text-3)', fontSize: 14 }}>未找到会话</div>
  }

  const handleSend = () => {
    const content = draft.trim()
    if (!content || !session) return
    // 直接通过 wsClient 发 prompt,带 sessionId,不依赖 store 的 currentSessionId
    const clientMessageId = `msg-local-${Date.now()}`
    wsClient.send({ type: 'prompt', sessionId: session.id, content, clientMessageId })
    // 乐观插入用户消息
    setLocalMessages((prev) => [
      ...prev,
      {
        id: clientMessageId,
        session_id: session.id,
        role: 'human',
        content,
        thinking: null,
        tool_calls_json: null,
        decision_json: null,
        timestamp: new Date().toISOString(),
      },
    ])
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
        {localStreaming && (
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
            {localStreaming.content || 'Agent 正在处理...'}
          </div>
        )}
        {sessionMessages.length === 0 && !localStreaming && (
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
