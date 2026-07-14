import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Bot, FolderOpen } from 'lucide-react'
import { buildChatRenderItems } from '@desktop/components/chat/render-items'
import type { ChatTimelineGroup, MessageData, StreamingMessage } from '@desktop/stores/session-events'
import { useChatStore } from '../stores/chat.store'
import { useSessionStore } from '../stores/session.store'
import { useConnectionStore } from '../stores/connection.store'
import { useAppStore } from '../stores/app.store'
import { showToast } from '../utils/toast'
import ChatBubble from '../components/chat/ChatBubble'
import ChatInput from '../components/chat/ChatInput'
import TurnContent from '../components/chat/TurnContent'
import PlanBar from '../components/chat/PlanBar'
import PermissionCard from '../components/chat/PermissionCard'
import ElicitationCard from '../components/chat/ElicitationCard'
import ConfigToolbar from '../components/chat/ConfigToolbar'
import { deriveLiveElapsedSeconds } from '../utils/chat-elapsed'

type MobileChatMessage = MessageData | (StreamingMessage & { session_id?: string })

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const olderLoadAnchorRef = useRef<{ sessionId: string; scrollHeight: number; scrollTop: number } | null>(null)

  // 新建会话占位路由 /chat/new?projectId=xxx[&agentId=yyy]:UI 上等同一个空白会话,
  // 但底层 sessionId 还没生成。在用户首次发送前先调 sessions.create 拿到真 sessionId,
  // 再 navigate 替换 URL,最后走正常 prompt 流程。直接用 'new' 当 sessionId 会触发
  // enterSession('new') / markRead('new') / prompt('new'),后端报 Session not found。
  const isNewSessionRoute = sessionId === 'new'
  const pendingProjectId = searchParams.get('projectId')
  const pendingAgentId = searchParams.get('agentId')
  const creatingRef = useRef(false)

  // 拆 selector 订阅:每个字段独立订阅,避免一把抓导致任一变化都触发整个组件重渲染。
  // 流式期间 streamingMessage 每 16ms(RAF)变一次,如果订阅整个 store,整个 ChatPage
  // 都会重渲染;拆开后只有 streaming 子组件重渲染,历史消息列表纹丝不动。
  const messages = useChatStore(s => s.messages)
  const events = useChatStore(s => s.events)
  const streamingMessage = useChatStore(s => s.streamingMessage)
  const loading = useChatStore(s => s.loading)
  const isRunning = useChatStore(s => s.isRunning)
  const sendError = useChatStore(s => s.sendError)
  const plan = useChatStore(s => s.plan)
  const pendingPermissions = useChatStore(s => s.pendingPermissions)
  const pendingElicitations = useChatStore(s => s.pendingElicitations)
  const capabilities = useChatStore(s => s.capabilities)
  const turnProcessLoadingByMessageId = useChatStore(s => s.turnProcessLoadingByMessageId)
  const turnProcessErrorByMessageId = useChatStore(s => s.turnProcessErrorByMessageId)
  const runningStartedAtMs = useChatStore(s => s.runningStartedAtMs)
  const hasMoreMessagesBySession = useChatStore(s => s.hasMoreMessagesBySession)
  const loadingOlderMessagesBySession = useChatStore(s => s.loadingOlderMessagesBySession)
  const enterSession = useChatStore(s => s.enterSession)
  const leaveSession = useChatStore(s => s.leaveSession)
  const loadOlderMessages = useChatStore(s => s.loadOlderMessages)
  const sendPrompt = useChatStore(s => s.sendPrompt)
  const cancelTurn = useChatStore(s => s.cancelTurn)
  const fetchMessageProcess = useChatStore(s => s.fetchMessageProcess)
  const refreshCurrentSession = useChatStore(s => s.refreshCurrentSession)
  const respondPermission = useChatStore(s => s.respondPermission)
  const respondElicitation = useChatStore(s => s.respondElicitation)
  const setModel = useChatStore(s => s.setModel)
  const setMode = useChatStore(s => s.setMode)
  const setConfig = useChatStore(s => s.setConfig)

  const sessions = useSessionStore(s => s.sessions)
  const connected = useConnectionStore(s => s.connected)
  const status = useConnectionStore(s => s.status)
  const session = sessions.find(s => s.id === sessionId)

  const listenersRef = useRef(false)
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now())
  const hasMoreMessages = sessionId ? hasMoreMessagesBySession[sessionId] === true : false
  const loadingOlderMessages = sessionId ? !!loadingOlderMessagesBySession[sessionId] : false

  useEffect(() => {
    // 跳过 'new' 占位路由:此时还没有真 sessionId,enterSession/markRead 都不应触发。
    // 真正的 session 订阅在 handleSend 里调 createSession 后,navigate 到 /chat/${realId},
    // 该 effect 因 sessionId 变化重跑,自然走到下方正常分支。
    if (!sessionId || isNewSessionRoute) return
    stickToBottomRef.current = true
    olderLoadAnchorRef.current = null
    useSessionStore.getState().setCurrentSession(sessionId)
    enterSession(sessionId)
    useSessionStore.getState().markRead(sessionId)
    if (!listenersRef.current) {
      listenersRef.current = true
      const off = useChatStore.getState().setupListeners()
      return () => {
        off()
        listenersRef.current = false
        leaveSession()
        useSessionStore.getState().setCurrentSession(null)
      }
    }
    return () => {
      leaveSession()
      useSessionStore.getState().setCurrentSession(null)
    }
  }, [sessionId, isNewSessionRoute])

  // Reconnect recovery: when the websocket comes back online, refill the
  // current conversation with the latest persisted messages and events so we
  // don't leave the user staring at stale state after a background disconnect.
  // 单触发:refreshCurrentSession 内部用 refreshInFlight 去重,避免重连时
  // 4 路并发刷新(ChatPage effect + chat.store reconnected listener 已删除)。
  useEffect(() => {
    if (!connected || !sessionId || isNewSessionRoute) return
    void refreshCurrentSession(sessionId)
  }, [connected, sessionId, isNewSessionRoute, refreshCurrentSession])

  const hasBlockingInteraction = pendingPermissions.length > 0 || pendingElicitations.length > 0
  const inputDisabled = hasBlockingInteraction || !connected
  const disabledPlaceholder = !connected
    ? (status === 'connecting' ? '正在重连服务器...' : '连接失败，请先恢复连接')
    : '等待确认...'
  const projectId = session?.projectId ?? null
  const canViewFiles = !!projectId

  // 新建会话占位路由下,首次发送要先调 sessions.create 拿真 sessionId,再 navigate 替换 URL,
  // 最后走正常 sendPrompt。createSession 期间禁用输入框防止重复触发。
  const [creating, setCreating] = useState(false)
  const agents = useAppStore(s => s.agents)

  const handleSend = useCallback(async (text: string, images?: Parameters<typeof sendPrompt>[1]) => {
    if (isNewSessionRoute) {
      if (creatingRef.current) return
      // URL query 必须带 projectId;agentId 没带就用当前 project 第一个可见 agent 兜底
      // (与 SessionListPage.handleNewFromTemplate 的兜底策略一致)。
      const targetProjectId = pendingProjectId
      if (!targetProjectId) {
        showToast('缺少项目信息,请返回重试')
        return
      }
      let targetAgentId = pendingAgentId
      if (!targetAgentId) {
        // 从当前列表里按当前 project 过滤第一个 agent;找不到再回退到全局第一个 agent。
        const inProject = sessions.find((s) => s.projectId === targetProjectId)
        if (inProject) {
          targetAgentId = inProject.agentId
        } else {
          targetAgentId = agents[0]?.id
        }
      }
      if (!targetAgentId) {
        showToast('未找到可用 Agent,请先在项目中添加 Agent')
        return
      }
      creatingRef.current = true
      setCreating(true)
      try {
        const real = await useSessionStore.getState().createSession(targetAgentId, targetProjectId)
        // navigate 替换 URL,触发 ChatPage 重新挂载到真 sessionId 分支;随后 effect 会
        // 自动 enterSession/markRead。发送时机:navigate 是异步生效,直接调 sendPrompt
        // 时 chat.store 的 sessionId 还是 null,因此把发送动作延后到 URL 切换之后。
        navigate(`/chat/${real.id}`, { replace: true })
        // 等下一帧让 useParams 拿到新 sessionId 并完成 enterSession,再触发 sendPrompt。
        // 两次 RAF 足以覆盖 React 18 的并发渲染 + effect 提交窗口。
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            useChatStore.getState().sendPrompt(text, images)
          })
        })
      } catch (err) {
        showToast(err instanceof Error ? err.message : '创建会话失败')
      } finally {
        creatingRef.current = false
        setCreating(false)
      }
      return
    }
    sendPrompt(text, images)
  }, [isNewSessionRoute, pendingProjectId, pendingAgentId, sessions, agents, navigate, sendPrompt])
  const handleOpenFiles = () => {
    if (!canViewFiles) return
    navigate('/files', { state: { projectId, sessionId } })
  }

  // 新建会话占位路由下,header 标题用项目名/默认文案,不显示"对话"。
  const projects = useAppStore(s => s.projects)
  const headerTitle = isNewSessionRoute
    ? (projects.find((p) => p.id === pendingProjectId)?.name || '新对话')
    : (session?.sessionTitle || session?.agentName || '对话')
  useEffect(() => {
    if (!isRunning) return undefined
    setLiveNowMs(Date.now())
    const timer = window.setInterval(() => setLiveNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isRunning, sessionId])

  const liveElapsedSeconds = useMemo(() => deriveLiveElapsedSeconds({
    isRunning,
    sessionId,
    nowMs: liveNowMs,
    runningStartedAtMs,
    messages,
  }), [isRunning, liveNowMs, messages, runningStartedAtMs, sessionId])

  const chatItems = useMemo(() => buildChatRenderItems<MobileChatMessage>({
    sessionId: sessionId ?? null,
    messages,
    events,
    streamingBubble: streamingMessage ? { ...streamingMessage, session_id: sessionId } : null,
    showStreamingBubble: !!streamingMessage,
    blockingInteraction: hasBlockingInteraction,
  }), [events, hasBlockingInteraction, messages, sessionId, streamingMessage])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 120
    if (!sessionId || !hasMoreMessages || loadingOlderMessages || el.scrollTop > 80) return
    olderLoadAnchorRef.current = {
      sessionId,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    }
    void loadOlderMessages(sessionId)
  }, [hasMoreMessages, loadOlderMessages, loadingOlderMessages, sessionId])

  // 滚动 effect 改为 messages.length 驱动:流式期间 streamingMessage 每 16ms(RAF)变,
  // 旧实现依赖 chatItems(包含 streamingMessage),每 16ms 强制 scrollTop = scrollHeight,
  // 触发 forced reflow。改为只依赖 messages.length,流式期间不强制滚动,浏览器原生
  // overflow-anchor 处理滚动跟随(若支持),零 JS reflow。
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const olderLoadAnchor = olderLoadAnchorRef.current
    if (olderLoadAnchor && olderLoadAnchor.sessionId === sessionId) {
      const delta = el.scrollHeight - olderLoadAnchor.scrollHeight
      el.scrollTop = olderLoadAnchor.scrollTop + delta
      olderLoadAnchorRef.current = null
      return
    }
    // 只在消息条数变化时强制滚底,流式内容增长不触发 forced reflow
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, sessionId])

  useEffect(() => {
    if (loadingOlderMessages) return
    const el = listRef.current
    const olderLoadAnchor = olderLoadAnchorRef.current
    if (!el || !olderLoadAnchor || olderLoadAnchor.sessionId !== sessionId) return
    const delta = el.scrollHeight - olderLoadAnchor.scrollHeight
    el.scrollTop = olderLoadAnchor.scrollTop + delta
    olderLoadAnchorRef.current = null
  }, [loadingOlderMessages, sessionId])

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/')}>
          <ArrowLeft size={20} />
        </button>
        <div style={styles.headerInfo}>
          <span style={styles.headerTitle}>{headerTitle}</span>
          {session && (
            <span style={styles.headerSub}>
              <Bot size={11} style={{ marginRight: 3 }} />
              {session.agentName}
            </span>
          )}
        </div>
        {isRunning && <span style={styles.runningDot} />}
        <button
          style={{ ...styles.backBtn, opacity: canViewFiles ? 1 : 0.4 }}
          onClick={handleOpenFiles}
          disabled={!canViewFiles}
          aria-label="查看文件"
          title={canViewFiles ? '查看项目文件' : '当前会话未绑定项目'}
        >
          <FolderOpen size={20} />
        </button>
      </div>

      {plan.length > 0 && <PlanBar plan={plan} />}

      <div ref={listRef} style={styles.messages} onScroll={handleScroll}>
        {loading && (
          <div style={styles.loadingWrap}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>加载中...</span>
          </div>
        )}
        {chatItems.map((item) => {
          if (item.kind === 'message') {
            const msg = item.message as MessageData
            return (
              <ChatBubble key={item.id} role={msg.role === 'human' ? 'human' : 'agent'}>
                {msg.role === 'agent' ? (
                  <TurnContent
                    message={msg}
                    processLoading={!!turnProcessLoadingByMessageId[msg.id]}
                    processError={turnProcessErrorByMessageId[msg.id]}
                    onLoadProcess={fetchMessageProcess}
                  />
                ) : (
                  <span>{msg.content}</span>
                )}
              </ChatBubble>
            )
          }
          if (item.kind === 'streaming') {
            return (
              <ChatBubble key={item.id} role="agent">
                <TurnContent streaming={item.message as StreamingMessage} liveElapsedSeconds={liveElapsedSeconds} />
              </ChatBubble>
            )
          }
          if (item.kind === 'group') {
            return (
              <ChatBubble key={item.id} role={item.group.role === 'human' ? 'human' : 'agent'}>
                <TimelineGroupContent group={item.group} />
              </ChatBubble>
            )
          }
          return null
        })}

        {pendingPermissions.map(p => (
          <PermissionCard
            key={p.id}
            request={p}
            onRespond={(optionId, cancelled) => respondPermission(p.id, optionId, cancelled)}
          />
        ))}
        {pendingElicitations.map(e => (
          <ElicitationCard
            key={e.id}
            request={e}
            onRespond={(action, content) => respondElicitation(e.id, action, content)}
          />
        ))}
      </div>

      {sendError && <div style={styles.sendError}>{sendError}</div>}
      <ConfigToolbar
        capabilities={capabilities}
        onSetModel={setModel}
        onSetMode={setMode}
        onSetConfig={setConfig}
      />
      <ChatInput
        onSend={handleSend}
        onCancel={cancelTurn}
        isRunning={isRunning || creating}
        disabled={inputDisabled || creating}
        disabledPlaceholder={disabledPlaceholder}
        supportsImages={capabilities.supportsImages}
      />
    </div>
  )
}

function TimelineGroupContent({ group }: { group: ChatTimelineGroup }) {
  return (
    <div style={styles.timelineGroup}>
      {group.blocks.map((block) => {
        if (block.kind === 'message') {
          return <div key={block.id}>{block.content}</div>
        }
        return <div key={block.id} style={styles.timelineTool}>{block.toolCall.title || '工具调用'}</div>
      })}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    paddingTop: 'calc(10px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  backBtn: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    display: 'block',
    fontSize: 16,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerSub: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    color: 'var(--text-muted)',
    marginTop: 1,
  },
  runningDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--success)',
    flexShrink: 0,
    animation: 'pulse 1.5s infinite',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 0',
  },
  loadingWrap: {
    display: 'flex',
    justifyContent: 'center',
    padding: 20,
  },
  timelineGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  timelineTool: {
    fontSize: 12,
    color: 'var(--text-muted)',
  },
  sendError: {
    padding: '7px 12px',
    background: 'var(--error-bg)',
    color: 'var(--error)',
    fontSize: 12,
    textAlign: 'center',
    borderTop: '1px solid var(--border-light)',
  },
}
