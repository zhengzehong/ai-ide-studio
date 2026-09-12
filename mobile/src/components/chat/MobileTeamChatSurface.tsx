import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bot, FolderOpen } from 'lucide-react'
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
import { PresentedFilesOverlay } from '../file-viewer/PresentedFilesOverlay'
import { ConversationKindTag } from '../session-list/ConversationKindTag'
import { useConnectionStore } from '../../stores/connection.store'
import { resolveChatReturnTo } from '../../pages/ChatPage'
import { SessionAttentionPanel } from './SessionAttentionPanel'
import { useTeamAttention } from './use-team-attention'
import { teamChatStyles as styles } from './team-chat.styles'

export function MobileTeamChatSurface({ adapter }: { adapter: ConversationAdapter }): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const connected = useConnectionStore(state => state.connected)
  const connectionStatus = useConnectionStore(state => state.status)
  const attention = useTeamAttention(adapter, () => navigate(resolveChatReturnTo(location.state)))
  const [now, setNow] = useState(Date.now)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<FilesPresentationInfo | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const olderRef = useRef<{ height: number; top: number } | null>(null)
  const streams = (adapter.streamingMessages ?? (adapter.streamingMessage ? [adapter.streamingMessage] : [])).filter(turn => !turn.done)
  const liveIds = new Set(streams.map(turn => turn.id))
  const messages = adapter.messages.filter(message => !liveIds.has(message.id))
  const senderId = (id: string): string => adapter.senderAgentIds?.[id.split(':')[0]] || id.split(':')[0]
  const perform = useCallback((operation: () => Promise<unknown>): void => {
    setError(null)
    void operation().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '操作失败'))
  }, [])
  useEffect(() => {
    if (followRef.current && !olderRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length, streams.length])
  useEffect(() => {
    if (!adapter.running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [adapter.running])
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
  return <div style={styles.page}>
    <header style={styles.header}>
      <button aria-label="返回会话列表" onClick={() => navigate(resolveChatReturnTo(location.state))} style={styles.backBtn}><ArrowLeft size={20} /></button>
      <div style={styles.headerInfo}>
        <span style={styles.headerTitle}>{adapter.sessionTitle || '新团队会话'}</span>
        <span style={styles.headerSub}><Bot size={11} style={{ marginRight: 3 }} />{adapter.agentName}<ConversationKindTag team /></span>
      </div>
      {adapter.running && <span style={styles.runningDot} />}
      <button aria-label="查看文件" disabled={!adapter.projectId} title={adapter.projectId ? '查看项目文件' : '当前会话未绑定项目'} onClick={() => navigate('/files', { state: { projectId: adapter.projectId, sessionId: adapter.sessionId } })} style={{ ...styles.backBtn, opacity: adapter.projectId ? 1 : 0.4 }}><FolderOpen size={20} /></button>
    </header>
    <div ref={scrollRef} style={styles.messages} onClick={() => { if (attention.open) attention.setOpen(false) }} onScroll={() => {
      const element = scrollRef.current
      if (!element) return
      followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 120
      if (element.scrollTop <= 80) loadOlder()
    }}>
      <div>
        {(adapter.loading || adapter.loadingOlderMessages) && <div role="status" style={styles.loadingWrap}><span style={{ color: 'var(--text-muted)', fontSize: 13 }}>加载中...</span></div>}
        {messages.map(message => {
          if (message.sender_role === 'team-system') return <div key={message.id} style={{ margin: '8px 16px', padding: 8, color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'pre-wrap' }}>{message.content}</div>
          const process = adapter.processByMessageId?.[message.id]
          const loaded = process?.loaded ? { ...message, processBlocks: process.blocks } : message
          return <ChatBubble key={message.id} role={message.role === 'human' ? 'human' : 'agent'} agentId={senderId(message.id)}>
            {message.role !== 'human' && <><span style={styles.sender}>{message.sender_name || 'Master'}</span><Assignment assignment={message.teamAssignment} /></>}
            {message.role === 'human' ? <><span>{message.content}</span>{message.parsedAttachments?.map((image, index) => <AuthenticatedImage key={index} image={image} alt={image.name || '附件'} style={{ display: 'block', maxWidth: '100%', marginTop: 8 }} />)}</> : <TurnContent message={loaded} processLoading={process?.loading} processError={process?.error} onLoadProcess={(_session, id) => perform(() => adapter.loadMessageProcess(id))} {...media} />}
          </ChatBubble>
        })}
        {streams.map(turn => <ChatBubble key={turn.id} role="agent" agentId={senderId(turn.id)}><span style={styles.sender}>{turn.senderName || 'Master'}</span><Assignment assignment={turn.teamAssignment} /><TurnContent streaming={turn} liveElapsedSeconds={turn.startedAt && Number.isFinite(Date.parse(turn.startedAt)) ? Math.max(0, Math.floor((now - Date.parse(turn.startedAt)) / 1000)) : undefined} {...media} /></ChatBubble>)}
        {adapter.pendingPermissions.map(request => <PermissionCard key={request.id} request={request} onRespond={(option, cancelled) => perform(() => adapter.respondPermission(request.id, option, cancelled))} />)}
        {adapter.pendingElicitations.map(request => <ElicitationCard key={request.id} request={request} onRespond={(action, content) => perform(() => adapter.respondElicitation(request.id, action, content))} />)}
      </div>
    </div>
    {(error || adapter.error) && <div role="alert" style={styles.sendError}>{error || adapter.error}{adapter.error && adapter.reload && <button style={{ marginLeft: 8, fontSize: 'inherit', color: 'inherit' }} onClick={() => perform(adapter.reload!)}>重试同步</button>}</div>}
    <ConfigToolbar capabilities={adapter.capabilities} onSetModel={id => { if (adapter.setModel) perform(() => adapter.setModel!(id)) }} onSetMode={id => { if (adapter.setMode) perform(() => adapter.setMode!(id)) }} onSetConfig={(id, value) => { if (adapter.setConfig) perform(() => adapter.setConfig!(id, value)) }} />
    <ChatInput onSend={(text, images) => { followRef.current = true; perform(() => adapter.sendPrompt(text, images)) }} onCancel={() => perform(adapter.cancel)} isRunning={adapter.running} disabled={!connected || adapter.sending || adapter.pendingPermissions.some(request => !request.resolved) || adapter.pendingElicitations.some(request => !request.resolved)} disabledPlaceholder={!connected ? (connectionStatus === 'connecting' ? '正在重连服务器...' : '连接失败，请先恢复连接') : '等待确认...'} supportsImages={adapter.capabilities.supportsImages}
      actionsOpen={attention.open} onToggleActions={() => attention.setOpen(!attention.open)}
      actionsPanel={<SessionAttentionPanel pinned={attention.pinned} canMarkUnread={messages.length > 0 && !!adapter.markUnread} pendingAction={attention.pending} onTogglePin={() => { void attention.togglePin() }} onMarkUnread={() => { void attention.markUnread() }} />}
    />
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
