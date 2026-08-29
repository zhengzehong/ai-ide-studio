import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import { VirtualChatList } from '../components/chat/VirtualChatList'
import { InteractionPanel } from '../components/global-assistant/GlobalAssistantInteractions'
import { useWorkbenchSessionStore } from '../stores/workbench-session.store'
import type { MessageData } from '../stores/session-events'
import type { TurnProcessBlock } from '../stores/turn-blocks'
import type { WorkbenchSessionTarget } from './UpdatesSidebar'
import './updates/updates-content.css'

interface UpdatesConversationProps { target: WorkbenchSessionTarget | null; onSelectTarget: (target: WorkbenchSessionTarget) => Promise<void> }

export function UpdatesConversation({ target, onSelectTarget }: UpdatesConversationProps) {
  const selectedSessionId = useWorkbenchSessionStore((state) => state.selectedSessionId)
  const messages = useWorkbenchSessionStore((state) => state.messages)
  const streamingMessage = useWorkbenchSessionStore((state) => state.streamingMessage)
  const loading = useWorkbenchSessionStore((state) => state.loading)
  const error = useWorkbenchSessionStore((state) => state.error)
  const sendPrompt = useWorkbenchSessionStore((state) => state.sendPrompt)
  const cancel = useWorkbenchSessionStore((state) => state.cancel)
  const pendingPermissions = useWorkbenchSessionStore((state) => state.pendingPermissions)
  const pendingElicitations = useWorkbenchSessionStore((state) => state.pendingElicitations)
  const interactionError = useWorkbenchSessionStore((state) => state.interactionError)
  const respondPermission = useWorkbenchSessionStore((state) => state.respondPermission)
  const respondElicitation = useWorkbenchSessionStore((state) => state.respondElicitation)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const isCurrent = !!target && selectedSessionId === target.sessionId
  const sessionMessages = useMemo(() => isCurrent ? messages.filter((message) => message.session_id === target?.sessionId) : [], [isCurrent, messages, target?.sessionId])
  const isStreaming = isCurrent && !!streamingMessage && !streamingMessage.done

  useEffect(() => { if (isStreaming && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [isStreaming, streamingMessage])
  const submit = async (): Promise<void> => { const content = draft.trim(); if (!content || !isCurrent) return; setDraft(''); try { await sendPrompt(content) } catch { setDraft(content) } }

  if (!target) return <main className="workbench-conversation workbench-conversation-empty"><div><strong>选择一个会话</strong><span>从左侧动态或置顶列表打开会话</span></div></main>
  return <main className="workbench-conversation">
    <header className="workbench-conversation-header"><div className="workbench-conversation-title"><strong>{target.title}</strong><span>{target.projectId || '未归属项目'} · {target.sessionId.slice(0, 8)}</span></div><button type="button" className="workbench-text-button" onClick={() => void onSelectTarget(target)}>重新加载</button></header>
    <div className="workbench-message-scroll" ref={scrollRef}>
      {loading && sessionMessages.length === 0 && <div className="workbench-loading">正在加载会话...</div>}
      {error && <div className="workbench-inline-error">{error}</div>}
      {!error && sessionMessages.length === 0 && !loading && <div className="workbench-loading">暂无消息</div>}
      <VirtualChatList items={sessionMessages} getKey={(message) => message.id} scrollRef={scrollRef} renderItem={(message) => <ConversationMessage message={message} />} />
      {isStreaming && streamingMessage && <article className="workbench-message workbench-message-agent is-streaming"><div className="workbench-message-meta"><span>Agent</span><span className="workbench-live-dot" />实时输出</div><MarkdownRenderer content={streamingMessage.finalAnswer || streamingMessage.stage || '正在处理...'} /></article>}
    </div>
    {(pendingPermissions.length > 0 || pendingElicitations.length > 0 || interactionError) && <div className="workbench-interactions">{interactionError && <div className="workbench-inline-error">{interactionError}</div>}<InteractionPanel permission={pendingPermissions[0]} elicitation={pendingPermissions.length === 0 ? pendingElicitations[0] : undefined} onRespondPermission={respondPermission} onRespondElicitation={respondElicitation} /></div>}
    <footer className="workbench-composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder="继续和 Agent 对话..." rows={2} />{isStreaming ? <button type="button" className="workbench-send-button is-stop" onClick={() => { void cancel() }} title="停止"><Square size={15} fill="currentColor" /></button> : <button type="button" className="workbench-send-button" onClick={() => { void submit() }} disabled={!draft.trim()} title="发送"><Send size={15} /></button>}</footer>
  </main>
}

function ConversationMessage({ message }: { message: MessageData }) { const content = message.finalAnswer ?? message.content; return <article className={`workbench-message workbench-message-${message.role}`}><div className="workbench-message-meta"><span>{message.role === 'human' ? '你' : message.role === 'agent' ? 'Agent' : '系统'}</span><time>{formatTime(message.timestamp)}</time></div>{message.processBlocks && <ProcessSummary blocks={message.processBlocks} />}{content && <MarkdownRenderer content={content} />}</article> }
function ProcessSummary({ blocks }: { blocks: TurnProcessBlock[] }) { const visible = blocks.filter((block) => block.kind !== 'stage'); return visible.length ? <details className="workbench-process"><summary>执行过程 · {visible.length} 项</summary>{visible.map((block) => <div key={block.id} className="workbench-process-item">{block.kind === 'tool' ? block.toolCall.title : block.kind === 'thinking' ? '思考' : block.kind}</div>)}</details> : null }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
