import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Bot, Loader2, Paperclip, Pin, RefreshCw, Settings2, Square, User, ChevronDown } from 'lucide-react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import { VirtualChatList } from '../components/chat/VirtualChatList'
import { InteractionPanel } from '../components/global-assistant/GlobalAssistantInteractions'
import { useSessionDockStore } from '../stores/session-dock.store'
import { useWorkbenchSessionStore } from '../stores/workbench-session.store'
import type { MessageData } from '../stores/session-events'
import type { TurnProcessBlock } from '../stores/turn-blocks'
import type { WorkbenchSessionTarget } from './UpdatesSidebar'
import './updates/updates-content.css'

interface UpdatesConversationProps { target: WorkbenchSessionTarget | null; onSelectTarget: (target: WorkbenchSessionTarget) => Promise<void> }

const AVATAR_PALETTE = ['var(--green)', 'var(--purple)', 'var(--orange)', 'var(--blue)', 'var(--yellow)']
const toolbarChipStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: 'none',
  background: 'var(--bg-1)', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
}

function agentAvatarColor(seed: string | null | undefined): string {
  if (!seed) return 'var(--bg-3)'
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 997
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

export function UpdatesConversation({ target, onSelectTarget }: UpdatesConversationProps) {
  const selectedSessionId = useWorkbenchSessionStore((state) => state.selectedSessionId)
  const messages = useWorkbenchSessionStore((state) => state.messages)
  const streamingMessage = useWorkbenchSessionStore((state) => state.streamingMessage)
  const loading = useWorkbenchSessionStore((state) => state.loading)
  const error = useWorkbenchSessionStore((state) => state.error)
  const running = useWorkbenchSessionStore((state) => state.running)
  const sendPrompt = useWorkbenchSessionStore((state) => state.sendPrompt)
  const cancel = useWorkbenchSessionStore((state) => state.cancel)
  const pendingPermissions = useWorkbenchSessionStore((state) => state.pendingPermissions)
  const pendingElicitations = useWorkbenchSessionStore((state) => state.pendingElicitations)
  const interactionError = useWorkbenchSessionStore((state) => state.interactionError)
  const respondPermission = useWorkbenchSessionStore((state) => state.respondPermission)
  const respondElicitation = useWorkbenchSessionStore((state) => state.respondElicitation)
  const capabilities = useWorkbenchSessionStore((state) => state.capabilities)
  const dockItems = useSessionDockStore((state) => state.items)
  const addToDock = useSessionDockStore((state) => state.add)
  const removeFromDock = useSessionDockStore((state) => state.remove)
  const [draft, setDraft] = useState('')
  const [pinPending, setPinPending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isCurrent = !!target && selectedSessionId === target.sessionId
  const sessionMessages = useMemo(() => isCurrent ? messages.filter((message) => message.session_id === target?.sessionId) : [], [isCurrent, messages, target?.sessionId])
  const isStreaming = isCurrent && !!streamingMessage && !streamingMessage.done
  const currentPinned = !!target && dockItems.some((item) => item.sessionId === target.sessionId)
  const currentModeName = capabilities.modes.find((mode) => mode.modeId === capabilities.currentModeId)?.name || capabilities.currentModeId
  const currentModelName = capabilities.models.find((model) => model.modelId === capabilities.currentModelId)?.name || capabilities.currentModelId

  useEffect(() => { if (isStreaming && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [isStreaming, streamingMessage])
  const submit = async (): Promise<void> => { const content = draft.trim(); if (!content || !isCurrent) return; setDraft(''); try { await sendPrompt(content) } catch { setDraft(content) } }
  const togglePin = async (): Promise<void> => {
    if (!target || pinPending) return
    setPinPending(true)
    try { if (currentPinned) await removeFromDock(target.sessionId); else await addToDock(target.sessionId) } finally { setPinPending(false) }
  }

  if (!target) {
    return (
      <main className="wb-conversation">
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '80px 20px' }}>
            <Bot size={48} color="var(--text-3)" style={{ marginBottom: 16, opacity: 0.3 }} />
            <div style={{ fontSize: 15, marginBottom: 8 }}>选择一个会话</div>
            <div style={{ fontSize: 14 }}>从左侧动态或置顶列表打开会话</div>
          </div>
        </div>
      </main>
    )
  }
  const agentColor = agentAvatarColor(target.agentName || target.sessionId)
  const statusText = isStreaming || running ? '运行中' : '空闲'
  return (
    <main className="wb-conversation">
      <header style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-0)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: agentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'white', flexShrink: 0 }}>
            {(target.agentName || 'A').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 15 }}>
              <span style={{ flexShrink: 0 }}>{target.agentName || 'Agent'}</span>
              <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>·</span>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target.title}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: 'var(--text-2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: target.projectColor || agentAvatarColor(target.projectId || target.projectName), display: 'inline-block' }} />
                {target.projectName || '未归属项目'}
              </span>
              {' · '}{statusText}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button type="button" className={`wb-icon-btn${currentPinned ? ' is-active' : ''}`} onClick={() => { void togglePin() }} disabled={pinPending} title={currentPinned ? '取消置顶' : '置顶会话'} aria-label="置顶">
            <Pin size={14} />
          </button>
          <button type="button" className="wb-icon-btn" onClick={() => { void onSelectTarget(target) }} title="重新加载" aria-label="重新加载">
            <RefreshCw size={14} />
          </button>
        </div>
      </header>
      <div className="wb-message-scroll" ref={scrollRef}>
        {loading && sessionMessages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '48px 0' }}><Loader2 size={18} style={{ animation: 'wb-rotate 1s linear infinite', marginBottom: 8 }} /><div>正在加载消息...</div></div>}
        {error && <div role="alert" style={{ textAlign: 'center', color: 'var(--text-3)', padding: '48px 0' }}><div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{error}</div></div>}
        {!error && !loading && sessionMessages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '48px 0' }}>暂无消息，开始对话吧</div>}
        <VirtualChatList items={sessionMessages} getKey={(message) => message.id} scrollRef={scrollRef} renderItem={(message) => <ConversationMessage message={message} agentColor={agentColor} agentName={target.agentName ?? null} />} />
        {isStreaming && streamingMessage && (
          <div data-bubble style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '0 auto', maxWidth: 'var(--wb-col)', padding: '0 20px', boxSizing: 'border-box' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: agentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Bot size={14} color="white" /></div>
            <div style={{ maxWidth: '75%', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{target.agentName || 'Agent'}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--blue)' }}><Loader2 size={10} style={{ animation: 'wb-rotate 1s linear infinite' }} /> 生成中</span>
              </div>
              <div className="wb-bubble"><MarkdownRenderer content={streamingMessage.finalAnswer || streamingMessage.stage || '正在处理...'} /></div>
            </div>
          </div>
        )}
      </div>
      {(pendingPermissions.length > 0 || pendingElicitations.length > 0 || interactionError) && (
        <div className="wb-interactions">
          {interactionError && <div className="wb-interaction-error">{interactionError}</div>}
          <InteractionPanel permission={pendingPermissions[0]} elicitation={pendingPermissions.length === 0 ? pendingElicitations[0] : undefined} onRespondPermission={respondPermission} onRespondElicitation={respondElicitation} />
        </div>
      )}
      <footer className="wb-composer">
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-0)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden', opacity: isCurrent ? 1 : 0.5 }}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }}
            placeholder={isCurrent ? '继续和 Agent 对话...' : '等待会话加载...'}
            disabled={!isCurrent}
            rows={2}
            style={{ width: '100%', padding: '14px 16px 8px', border: 'none', outline: 'none', resize: 'none', background: 'transparent', color: 'var(--text-1)', fontSize: 15, lineHeight: 1.6, fontFamily: 'inherit', minHeight: 56, maxHeight: 160, boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px 10px', gap: 4 }}>
            <button type="button" disabled title="附件上传即将支持" style={{ width: 30, height: 30, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default', flexShrink: 0 }}>
              <Paperclip size={15} />
            </button>
            {capabilities.modes.length > 0 && <span style={toolbarChipStyle}><Settings2 size={12} /> {currentModeName} <ChevronDown size={10} /></span>}
            <div style={{ flex: 1 }} />
            {capabilities.models.length > 0 && <span style={{ ...toolbarChipStyle, background: 'transparent' }}>{currentModelName} <ChevronDown size={10} /></span>}
            {isStreaming ? (
              <button type="button" onClick={() => { void cancel() }} title="停止生成" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--red)', cursor: 'pointer', background: 'transparent', color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                <Square size={14} fill="var(--red)" />
              </button>
            ) : null}
            <button type="button" onClick={() => { void submit() }} disabled={!draft.trim() || !isCurrent} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: draft.trim() && isCurrent ? 'pointer' : 'default', background: draft.trim() && isCurrent ? 'var(--text-1)' : 'var(--bg-3)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s' }}>
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </footer>
    </main>
  )
}

function ConversationMessage({ message, agentColor, agentName }: { message: MessageData; agentColor: string; agentName?: string | null }) {
  const content = message.finalAnswer ?? message.content
  const isHuman = message.role === 'human'
  return (
    <div data-bubble style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: isHuman ? 'row-reverse' : 'row', margin: '0 auto', maxWidth: 'var(--wb-col)', padding: '0 20px', boxSizing: 'border-box' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: isHuman ? 'var(--bg-3)' : agentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {isHuman ? <User size={14} color="var(--text-2)" /> : <Bot size={14} color="white" />}
      </div>
      <div style={{ maxWidth: '75%', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexDirection: isHuman ? 'row-reverse' : 'row' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{isHuman ? '你' : agentName || 'Agent'}</span>
          {message.timestamp && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatTime(message.timestamp)}</span>}
        </div>
        <div className="wb-bubble" style={isHuman ? { background: 'var(--blue-light)', borderColor: 'rgba(37,99,235,0.15)', borderRadius: '12px 2px 12px 12px' } : undefined}>
          {message.processBlocks && <ProcessSummary blocks={message.processBlocks} />}
          {content && <MarkdownRenderer content={content} />}
        </div>
      </div>
    </div>
  )
}

function ProcessSummary({ blocks }: { blocks: TurnProcessBlock[] }) { const visible = blocks.filter((block) => block.kind !== 'stage'); return visible.length ? <details className="wb-process"><summary>执行过程 · {visible.length} 项</summary>{visible.map((block) => <div key={block.id} className="wb-process-item">{block.kind === 'tool' ? block.toolCall.title : block.kind === 'thinking' ? '思考' : block.kind}</div>)}</details> : null }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
