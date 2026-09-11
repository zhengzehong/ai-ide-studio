import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, FolderOpen, Pin, PinOff } from 'lucide-react'
import type { ConversationAdapter } from '@desktop/components/chat/conversation-types'
import type { FilesPresentationInfo, TeamAssignmentInfo } from '@desktop/stores/session-events'
import { AuthenticatedImage } from '@desktop/components/chat/AuthenticatedImage'
import { resolveChatResource, type OpenChatResource } from '@desktop/services/chat-resource-links'
import ChatBubble from './ChatBubble'
import ChatInput from './ChatInput'
import TurnContent from './TurnContent'
import PermissionCard from './PermissionCard'
import ElicitationCard from './ElicitationCard'
import ConfigToolbar from './ConfigToolbar'
import PlanBar from './PlanBar'
import { PresentedFilesOverlay } from '../file-viewer/PresentedFilesOverlay'
import { ConversationKindTag } from '../session-list/ConversationKindTag'
import { usePinnedSessionStore } from '../../stores/pinned-session.store'
import { useConnectionStore } from '../../stores/connection.store'
import { resolveChatReturnTo } from '../../pages/ChatPage'

export function MobileTeamChatSurface({ adapter }: { adapter: ConversationAdapter }): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const connected = useConnectionStore(state => state.connected)
  const pins = usePinnedSessionStore()
  const pinned = pins.items.some(item => item.sessionId === adapter.sessionId)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<FilesPresentationInfo | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const olderRef = useRef<{ height: number; top: number } | null>(null)
  const streams = (adapter.streamingMessages ?? (adapter.streamingMessage ? [adapter.streamingMessage] : [])).filter(turn => !turn.done)
  const liveIds = new Set(streams.map(turn => turn.id))
  const messages = adapter.messages.filter(message => !liveIds.has(message.id))
  const perform = useCallback((operation: () => Promise<unknown>): void => {
    setError(null)
    void operation().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '操作失败'))
  }, [])
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (followRef.current && !olderRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      })
    })
    observer.observe(content)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [])
  useLayoutEffect(() => {
    if (adapter.loadingOlderMessages || !olderRef.current || !scrollRef.current) return
    const element = scrollRef.current
    element.scrollTop = olderRef.current.top + element.scrollHeight - olderRef.current.height
    olderRef.current = null
  }, [adapter.loadingOlderMessages, messages.length])
  const loadOlder = (): void => {
    if (!scrollRef.current || adapter.loadingOlderMessages || !adapter.hasMoreMessages) return
    olderRef.current = { height: scrollRef.current.scrollHeight, top: scrollRef.current.scrollTop }
    perform(adapter.loadOlderMessages)
  }
  const openResource = useCallback<OpenChatResource>(async reference => {
    if (!adapter.projectId) throw new Error('当前会话未绑定项目')
    const resource = await resolveChatResource(adapter.projectId, reference)
    navigate('/files', { state: { projectId: adapter.projectId, sessionId: adapter.sessionId, ...(resource.kind === 'directory' ? { rootPath: resource.path } : { filePath: resource.path }) } })
    return resource
  }, [adapter.projectId, adapter.sessionId, navigate])
  const media = {
    onOpenPreview: (id: string, target: 'pc' | 'app'): void => { navigate(`/preview/${id}?target=${target}`) },
    onOpenFiles: setFiles,
    onOpenResource: openResource,
  }
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--bg)' }}>
    <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(10px + var(--safe-top)) 16px 10px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' }}>
      <button aria-label="返回会话列表" onClick={() => navigate(resolveChatReturnTo(location.state))} style={{ width: 36, height: 36, flexShrink: 0 }}><ArrowLeft size={20} /></button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adapter.sessionTitle || '新团队会话'}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{adapter.agentName}<ConversationKindTag team /></div>
      </div>
      <button aria-label={pinned ? '取消置顶' : '置顶会话'} onClick={() => { if (adapter.sessionId) perform(() => pinned ? pins.remove(adapter.sessionId!) : pins.add(adapter.sessionId!)) }} style={{ width: 32, height: 36, flexShrink: 0 }}>{pinned ? <PinOff size={18} /> : <Pin size={18} />}</button>
      <button aria-label="查看项目文件" onClick={() => navigate('/files', { state: { projectId: adapter.projectId, sessionId: adapter.sessionId } })} style={{ width: 32, height: 36, flexShrink: 0 }}><FolderOpen size={20} /></button>
    </header>
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 0' }} onScroll={() => {
      const element = scrollRef.current
      if (!element) return
      followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 120
      if (element.scrollTop <= 80) loadOlder()
    }}>
      <div ref={contentRef}>
        {adapter.hasMoreMessages && <button disabled={adapter.loadingOlderMessages} onClick={loadOlder} style={{ width: '100%', padding: 8, color: 'var(--text-muted)' }}>{adapter.loadingOlderMessages ? '加载中…' : '加载更早消息'}</button>}
        {adapter.loading && <div role="status" style={{ padding: 20 }}>加载中…</div>}
        {messages.map(message => {
          if (message.sender_role === 'team-system') return <div key={message.id} style={{ margin: '8px 16px', padding: 8, color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'pre-wrap' }}>{message.content}</div>
          const process = adapter.processByMessageId?.[message.id]
          const loaded = process?.loaded ? { ...message, processBlocks: process.blocks } : message
          return <ChatBubble key={message.id} role={message.role === 'human' ? 'human' : 'agent'} agentId={message.sender_name}>
            {message.role !== 'human' && <><strong>{message.sender_name || 'Master'}</strong><Assignment assignment={message.teamAssignment} />{loaded.processBlocks?.filter(block => block.kind === 'plan').map(block => block.kind === 'plan' ? <PlanBar key={block.id} plan={block.plan} /> : null)}</>}
            {message.role === 'human' ? <><span>{message.content}</span>{message.parsedAttachments?.map((image, index) => <AuthenticatedImage key={index} image={image} alt={image.name || '附件'} style={{ display: 'block', maxWidth: '100%', marginTop: 8 }} />)}</> : <TurnContent message={loaded} processLoading={process?.loading} processError={process?.error} onLoadProcess={(_session, id) => perform(() => adapter.loadMessageProcess(id))} {...media} />}
          </ChatBubble>
        })}
        {streams.map(turn => <ChatBubble key={turn.id} role="agent" agentId={turn.senderName}><strong>{turn.senderName || 'Master'}</strong><Assignment assignment={turn.teamAssignment} />{turn.processBlocks.filter(block => block.kind === 'plan').map(block => block.kind === 'plan' ? <PlanBar key={block.id} plan={block.plan} /> : null)}<TurnContent streaming={turn} {...media} /></ChatBubble>)}
        {adapter.pendingPermissions.map(request => <PermissionCard key={request.id} request={request} onRespond={(option, cancelled) => perform(() => adapter.respondPermission(request.id, option, cancelled))} />)}
        {adapter.pendingElicitations.map(request => <ElicitationCard key={request.id} request={request} onRespond={(action, content) => perform(() => adapter.respondElicitation(request.id, action, content))} />)}
      </div>
    </div>
    {(error || adapter.error) && <button role="alert" style={{ padding: 10, color: 'var(--error)', textAlign: 'left' }} onClick={() => { if (adapter.reload) perform(adapter.reload) }}>{error || adapter.error}</button>}
    <ConfigToolbar capabilities={adapter.capabilities} onSetModel={id => { if (adapter.setModel) perform(() => adapter.setModel!(id)) }} onSetMode={id => { if (adapter.setMode) perform(() => adapter.setMode!(id)) }} onSetConfig={(id, value) => { if (adapter.setConfig) perform(() => adapter.setConfig!(id, value)) }} />
    <ChatInput onSend={(text, images) => { followRef.current = true; perform(() => adapter.sendPrompt(text, images)) }} onCancel={() => perform(adapter.cancel)} isRunning={adapter.running} disabled={!connected || adapter.sending || adapter.pendingPermissions.some(request => !request.resolved) || adapter.pendingElicitations.some(request => !request.resolved)} supportsImages={adapter.capabilities.supportsImages} />
    {files && <PresentedFilesOverlay presentation={files} onClose={() => setFiles(null)} />}
  </div>
}

function Assignment({ assignment }: { assignment?: TeamAssignmentInfo }): ReactElement | null {
  const [expanded, setExpanded] = useState(false)
  if (!assignment) return null
  return <div style={{ margin: '6px 0', padding: 8, background: 'var(--bg)', borderRadius: 4 }}>
    <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)} style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{assignment.fromName} 安排的任务 · {expanded ? '收起' : '展开'}</button>
    <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: expanded ? undefined : 3, overflow: 'hidden' }}>{assignment.content}</div>
  </div>
}
