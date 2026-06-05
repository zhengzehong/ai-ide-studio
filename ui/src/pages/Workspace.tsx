import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
  useMemo,
  type MouseEvent,
  type DragEvent,
  type ClipboardEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  User,
  Wifi,
  WifiOff,
  Wrench,
  Check,
  X,
  Settings2,
  Square,
  ListTodo,
  CheckCircle2,
  Circle,
  Archive,
  Zap,
  Paperclip,
  ArrowUp,
  FileText,
  FolderOpen,
  MessageSquare as MessageSquareIcon,
} from 'lucide-react'
import { useAgentStore, type AgentData } from '../stores/agent.store'
import {
  readStoredSessionId,
  useSessionStore,
  type ChatTimelineGroup,
  type ChatTimelineItem,
  type ElicitationRequestInfo,
  type FileChangeDetailInfo,
  type FileChangeSummaryInfo,
  type ImageAttachmentInfo,
  type PermissionRequestInfo,
  type PlanEntry,
  type ToolCallInfo,
} from '../stores/session.store'
import type { TurnProcessBlock } from '../stores/turn-blocks'
import { useTaskStore, type TaskData } from '../stores/task.store'
import { useConnectionStore } from '../stores/connection.store'
import { useProjectStore } from '../stores/project.store'
import { useFileSystemStore } from '../stores/filesystem.store'
import { useTeamStore } from '../stores/team.store'
import { wsClient } from '../services/ws-client'
import { FileTree } from '../components/file-viewer/FileTree'
import { FilePreview } from '../components/file-viewer/FilePreview'
import { LazyToolCallsBlock } from '../components/chat/LazyToolCallsBlock'
import { TurnContentView } from '../components/chat/TurnContentView'
import { FileChangesCard } from '../components/chat/FileChangesCard'
import { extractFileChangesFromToolCall, extractTurnFileChanges, fileChangesFromSummary, toolBlockHasDiff } from '../components/chat/file-changes-utils'
import { isNearBottom, nextPinnedToBottom } from '../components/chat/auto-scroll'
import { shouldShowPlanBar } from '../components/chat/plan-visibility'
import { buildChatRenderItems, type ChatRenderItem } from '../components/chat/render-items'
import { VirtualChatList } from '../components/chat/VirtualChatList'
import { TeamContextPanel } from '../components/team/TeamContextPanel'
import { TimelinePopover } from '../components/chat/TimelinePopover'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import { permissionOptionLabel, isAllowPermissionOption, isRejectAlwaysOption } from '../utils/permission'
import {
  getElicitationOptions,
  getInitialElicitationValues,
  validateElicitationValues,
  type ElicitationSchema,
  type ElicitationValue,
} from '../utils/elicitation-form'
import {
  agentAvatar,
  agentColor,
  configLabel,
  configOptionLabel,
  formatTime,
  fmtTokens,
  menuStyle,
  modeCn,
  filterAgentsByProject,
  filterSessionsByProject,
  chatContentKey,
  selectChatAgent,
  sessionMenuItemStyle,
  sessionTitle,
  statusDot,
  statusLabel,
  toolSummary,
  type MenuAnchor,
  type MenuName,
} from './workspace/helpers'
import { sessionIndicator } from '../utils/session-indicators'
import { formatCompactDuration } from '../utils/duration'

export default function Workspace() {
  const navigate = useNavigate()
  const connected = useConnectionStore((s) => s.connected)
  const agents = useAgentStore((s) => s.agents)
  const sessions = useSessionStore((s) => s.sessions)
  const runningSessionIds = useSessionStore((s) => s.runningSessionIds)
  const unreadSessionIds = useSessionStore((s) => s.unreadSessionIds)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const messages = useSessionStore((s) => s.messages)
  const fetchMessageProcess = useSessionStore((s) => s.fetchMessageProcess)
  const fetchMessageFileChanges = useSessionStore((s) => s.fetchMessageFileChanges)
  const fileChangeDetailsByMessageId = useSessionStore((s) => s.fileChangeDetailsByMessageId)
  const turnProcessLoadingByMessageId = useSessionStore((s) => s.turnProcessLoadingByMessageId)
  const turnProcessErrorByMessageId = useSessionStore((s) => s.turnProcessErrorByMessageId)
  const toolCallLoadingByKey = useSessionStore((s) => s.toolCallLoadingByKey)
  const toolCallErrorByKey = useSessionStore((s) => s.toolCallErrorByKey)
  const events = useSessionStore((s) => s.events)
  const streamingMessage = useSessionStore((s) => s.streamingMessage)
  const usage = useSessionStore((s) => s.usage)
  const capabilities = useSessionStore((s) => s.capabilities)
  const plan = useSessionStore((s) => s.plan)
  const selectSession = useSessionStore((s) => s.selectSession)
  const sendPrompt = useSessionStore((s) => s.sendPrompt)
  const createSession = useSessionStore((s) => s.createSession)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const fetchMessages = useSessionStore((s) => s.fetchMessages)
  const fetchEvents = useSessionStore((s) => s.fetchEvents)
  const renameSession = useSessionStore((s) => s.renameSession)
  const copySession = useSessionStore((s) => s.copySession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const closeSession = useSessionStore((s) => s.closeSession)
  const archiveSession = useSessionStore((s) => s.archiveSession)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const fetchTasks = useTaskStore((s) => s.fetchTasks)
  const setModel = useSessionStore((s) => s.setModel)
  const setMode = useSessionStore((s) => s.setMode)
  const setConfig = useSessionStore((s) => s.setConfig)
  const cancelTurn = useSessionStore((s) => s.cancelTurn)
  const pendingPermissions = useSessionStore((s) => s.pendingPermissions)
  const pendingElicitations = useSessionStore((s) => s.pendingElicitations)
  const respondPermission = useSessionStore((s) => s.respondPermission)
  const respondElicitation = useSessionStore((s) => s.respondElicitation)
  const tasks = useTaskStore((s) => s.tasks)
  const createTask = useTaskStore((s) => s.createTask)
  const teamContext = useTeamStore((s) => s.current)
  const fetchCurrentTeam = useTeamStore((s) => s.fetchCurrent)
  const clearCurrentTeam = useTeamStore((s) => s.clearCurrent)

  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const fileTree = useFileSystemStore((s) => s.tree)
  const openFile = useFileSystemStore((s) => s.openFile)
  const fetchTree = useFileSystemStore((s) => s.fetchTree)
  const expandDir = useFileSystemStore((s) => s.expandDir)
  const openFileByPath = useFileSystemStore((s) => s.openFileByPath)
  const closeFile = useFileSystemStore((s) => s.closeFile)

  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'files'>('sessions')
  const [expandedAgents, setExpandedAgents] = useState<Set<string> | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  useEffect(() => {
    if (currentProjectId && sidebarTab === 'files') fetchTree(currentProjectId)
  }, [currentProjectId, sidebarTab, fetchTree])
  const [inputValue, setInputValue] = useState('')
  const [showNewTask, setShowNewTask] = useState(false)
  const [pendingImages, setPendingImages] = useState<{ data: string; mimeType: string; preview: string }[]>([])
  const [draggingImages, setDraggingImages] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showConfigMenu, setShowConfigMenu] = useState<string | null>(null)
  const [showCommandMenu, setShowCommandMenu] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const prevMsgCount = useRef(0)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stickToBottomRef = useRef(true)
  const lastScrollHeightRef = useRef(0)
  const pendingImagePreviewsRef = useRef<string[]>([])

  const projectAgents = useMemo(() => filterAgentsByProject(agents, currentProjectId), [agents, currentProjectId])
  const projectSessions = useMemo(
    () => filterSessionsByProject(sessions, currentProjectId),
    [sessions, currentProjectId],
  )
  const expandedAgentIds = useMemo(
    () => expandedAgents ?? new Set(projectAgents.map((a) => a.id)),
    [projectAgents, expandedAgents],
  )
  const chatAgent = useMemo(
    () => selectChatAgent({ agents: projectAgents, sessions: projectSessions, currentSessionId, selectedAgentId }),
    [currentSessionId, projectAgents, projectSessions, selectedAgentId],
  )
  const agentSessions = useCallback((id: string) => projectSessions.filter((s) => s.agent_id === id), [projectSessions])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = chatScrollRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior })
      stickToBottomRef.current = true
      lastScrollHeightRef.current = el.scrollHeight
    } else {
      chatEndRef.current?.scrollIntoView({ behavior })
    }
  }, [])

  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    requestAnimationFrame(() => scrollToBottom(behavior))
    scrollTimerRef.current = setTimeout(() => {
      scrollToBottom('auto')
      scrollTimerRef.current = setTimeout(() => {
        scrollToBottom('auto')
        scrollTimerRef.current = null
      }, 120)
    }, 40)
  }, [scrollToBottom])

  const updateStickToBottom = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    stickToBottomRef.current = nextPinnedToBottom({
      wasPinned: stickToBottomRef.current,
      previousScrollHeight: lastScrollHeightRef.current,
      metrics: el,
    })
    lastScrollHeightRef.current = el.scrollHeight
  }, [])

  const handleChatContentResize = useCallback(() => {
    if (stickToBottomRef.current) scheduleScrollToBottom('auto')
  }, [scheduleScrollToBottom])

  const streamingScrollSignature = useMemo(() => {
    if (!streamingMessage) return ''
    const lastTool = streamingMessage.toolCalls.at(-1)
    return [
      streamingMessage.content.length,
      streamingMessage.thinking.length,
      streamingMessage.toolCalls.length,
      streamingMessage.stage || '',
      lastTool?.id || '',
      lastTool?.status || '',
      lastTool?.terminalOutput?.length || 0,
      lastTool?.progress?.length || 0,
      lastTool?.rawOutput != null ? 1 : 0,
    ].join(':')
  }, [streamingMessage])
  const shouldScrollStreaming = !!streamingMessage && !streamingMessage.done

  useEffect(() => {
    const el = chatScrollRef.current
    if (!el) return undefined
    lastScrollHeightRef.current = el.scrollHeight
    stickToBottomRef.current = isNearBottom(el)
    el.addEventListener('scroll', updateStickToBottom, { passive: true })
    return () => { el.removeEventListener('scroll', updateStickToBottom) }
  }, [currentSessionId, updateStickToBottom])

  useEffect(() => {
    stickToBottomRef.current = true
    lastScrollHeightRef.current = chatScrollRef.current?.scrollHeight ?? 0
  }, [currentSessionId])

  useEffect(() => {
    if (messages.length !== prevMsgCount.current) {
      prevMsgCount.current = messages.length
      const el = chatScrollRef.current
      if (!el || stickToBottomRef.current || isNearBottom(el)) scheduleScrollToBottom('smooth')
    }
  }, [messages.length, scheduleScrollToBottom])
  useEffect(() => {
    if (shouldScrollStreaming && stickToBottomRef.current) scheduleScrollToBottom('auto')
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    }
  }, [shouldScrollStreaming, streamingScrollSignature, scheduleScrollToBottom])
  useEffect(() => {
    pendingImagePreviewsRef.current = pendingImages.map((img) => img.preview)
  }, [pendingImages])
  useEffect(() => () => pendingImagePreviewsRef.current.forEach((preview) => URL.revokeObjectURL(preview)), [])

  const autoResize = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  }

  const toggleAgent = (id: string) =>
    setExpandedAgents((p) => {
      const n = new Set(p ?? projectAgents.map((a) => a.id))
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  useEffect(() => {
    if (!currentSessionId) return
    const current = projectSessions.find((session) => session.id === currentSessionId)
    if (!currentProjectId || !current) selectSession(null)
  }, [currentProjectId, currentSessionId, projectSessions, selectSession])

  useEffect(() => {
    if (currentSessionId || projectSessions.length === 0) return
    const storedSessionId = readStoredSessionId()
    if (!storedSessionId) return
    const storedSession = projectSessions.find((session) => session.id === storedSessionId)
    if (!storedSession) return
    selectSession(storedSession.id)
  }, [currentSessionId, projectSessions, selectSession])

  const handleSelectSession = (agentId: string, sessionId: string) => {
    setSelectedAgentId(agentId)
    selectSession(sessionId)
  }
  const handleNewSession = async (agentId: string) => {
    const s = await createSession(agentId, undefined, currentProjectId ?? undefined)
    setSelectedAgentId(agentId)
    selectSession(s.id)
    await fetchSessions(undefined, currentProjectId ?? undefined)
  }
  const handleRenameSession = async (sessionId: string, currentTitle: string) => {
    const nextTitle = window.prompt('请输入新的会话名称', currentTitle)
    if (!nextTitle?.trim()) return
    await renameSession(sessionId, nextTitle)
    setSessionMenuId(null)
  }
  const handleCopySession = async (agentId: string, sessionId: string) => {
    const copied = await copySession(sessionId)
    setSelectedAgentId(agentId)
    selectSession(copied.id)
    setSessionMenuId(null)
    await fetchSessions(undefined, currentProjectId ?? undefined)
    await fetchMessages(copied.id)
    await fetchEvents(copied.id)
  }
  const handleDeleteSession = async (sessionId: string) => {
    if (!window.confirm('确定删除这个会话吗？历史记录会从列表隐藏。')) return
    await deleteSession(sessionId)
    setSessionMenuId(null)
  }
  const handleCloseSession = async (sessionId: string) => {
    await closeSession(sessionId)
    setSessionMenuId(null)
  }
  const handleArchiveSession = async (sessionId: string) => {
    await archiveSession(sessionId)
    setSessionMenuId(null)
  }

  useEffect(() => {
    if (!currentProjectId || !connected) return
    void fetchAgents(currentProjectId)
    void fetchSessions(undefined, currentProjectId)
    void fetchTasks(currentProjectId)
  }, [currentProjectId, connected, fetchAgents, fetchSessions, fetchTasks])

  useEffect(() => {
    if (!currentProjectId || !connected) return
    const off = wsClient.on('team:update', (msg) => {
      const sessionIds = Array.isArray(msg.sessionIds)
        ? msg.sessionIds.filter((id): id is string => typeof id === 'string')
        : []
      const teamId = typeof msg.teamId === 'string' ? msg.teamId : null
      const currentTeamId = teamContext.team?.id ?? null
      const shouldRefresh =
        (!!currentSessionId && sessionIds.includes(currentSessionId)) ||
        (!!currentTeamId && teamId === currentTeamId)
      if (!shouldRefresh) return

      void fetchAgents(currentProjectId)
      void fetchSessions(undefined, currentProjectId)
      void fetchTasks(currentProjectId)
    })
    return () => { off() }
  }, [connected, currentProjectId, currentSessionId, teamContext.team?.id, fetchAgents, fetchSessions, fetchTasks])

  useEffect(() => {
    if (!currentSessionId || !connected) {
      clearCurrentTeam()
      return
    }
    void fetchCurrentTeam(currentSessionId)
  }, [currentSessionId, connected, fetchCurrentTeam, clearCurrentTeam])

  const handleSend = () => {
    const v = inputValue.trim()
    const hasImages = pendingImages.length > 0
    if ((!v && !hasImages) || !currentSessionId || !connected || blockingInteraction) return
    stickToBottomRef.current = true
    sendPrompt(
      v,
      hasImages ? pendingImages.map((i) => ({ data: i.data, mimeType: i.mimeType })) : undefined,
    )
    setInputValue('')
    clearPendingImages()
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.focus()
      }
    })
  }
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) addImageFiles(Array.from(files))
    e.target.value = ''
  }
  const clearPendingImages = () => {
    setPendingImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.preview))
      return []
    })
  }
  const removePendingImage = (index: number) => {
    setPendingImages((prev) => {
      const removed = prev[index]
      if (removed) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== index)
    })
  }
  const addImageFiles = (files: File[]) => {
    files.filter((file) => file.type.startsWith('image/')).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () =>
        setPendingImages((prev) => [
          ...prev,
          { data: (reader.result as string).split(',')[1], mimeType: file.type, preview: URL.createObjectURL(file) },
        ])
      reader.readAsDataURL(file)
    })
  }
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    addImageFiles(files)
  }
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith('image/'))
    setDraggingImages(false)
    if (files.length === 0) return
    e.preventDefault()
    addImageFiles(files)
  }
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (Array.from(e.dataTransfer.items).some((item) => item.type.startsWith('image/'))) {
      e.preventDefault()
      setDraggingImages(true)
    }
  }
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDraggingImages(false)
  }

  const openMenu = (name: MenuName, e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const nextAnchor = { name, left: rect.left, top: rect.top - 8, minWidth: rect.width }
    setMenuAnchor(nextAnchor)
    setShowCommandMenu(name === 'command' ? !showCommandMenu : false)
    setShowModeMenu(name === 'mode' ? !showModeMenu : false)
    setShowModelMenu(name === 'model' ? !showModelMenu : false)
    setShowConfigMenu(name.startsWith('config:') ? (showConfigMenu === name.slice(7) ? null : name.slice(7)) : null)
  }

  const blockingInteraction = pendingPermissions.length > 0 || pendingElicitations.length > 0
  const canSendPrompt = !!currentSessionId && connected && !blockingInteraction && (!!inputValue.trim() || pendingImages.length > 0)
  const pendingInteractionId = pendingPermissions[0]?.id || pendingElicitations[0]?.id || ''
  const isStreaming = !!(streamingMessage && !streamingMessage.done)
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now())
  const latestHumanMessageTime = useMemo(() => {
    if (!isStreaming || !currentSessionId) return null
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.session_id === currentSessionId && message.role === 'human') {
        const timestamp = Date.parse(message.timestamp)
        return Number.isFinite(timestamp) ? timestamp : null
      }
    }
    return null
  }, [currentSessionId, isStreaming, messages])
  useEffect(() => {
    if (!isStreaming) return undefined
    const timer = window.setInterval(() => setLiveNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isStreaming])
  const liveElapsedSeconds = isStreaming && latestHumanMessageTime != null
    ? Math.max(0, Math.floor((liveNowMs - latestHumanMessageTime) / 1000))
    : undefined
  const streamingBubble = useMemo<ChatMsg | null>(() => {
    if (!isStreaming || !streamingMessage) return null
    return {
      id: streamingMessage.id,
      session_id: currentSessionId ?? undefined,
      role: 'agent',
      content: streamingMessage.content,
      thinking: streamingMessage.thinking,
      toolCalls: streamingMessage.toolCalls,
      processBlocks: streamingMessage.processBlocks,
      finalAnswer: streamingMessage.finalAnswer,
      stage: streamingMessage.stage,
      timestamp: new Date().toISOString(),
      streaming: true,
    }
  }, [currentSessionId, isStreaming, streamingMessage])
  const showStreamingBubble = !!streamingBubble
  const showPlanBar = shouldShowPlanBar({ plan, isStreaming, hasBlockingInteraction: blockingInteraction })
  const [showTimeline, setShowTimeline] = useState(false)
  const interactionPanel = useMemo(
    () =>
      blockingInteraction ? (
        <InteractionPanel
          permission={pendingPermissions[0]}
          elicitation={pendingPermissions.length === 0 ? pendingElicitations[0] : undefined}
          onRespondPermission={respondPermission}
          onRespondElicitation={respondElicitation}
        />
      ) : null,
    [blockingInteraction, pendingElicitations, pendingPermissions, respondElicitation, respondPermission],
  )

  const chatItems = useMemo<ChatRenderItem<ChatMsg>[]>(
    () => buildChatRenderItems<ChatMsg>({
      sessionId: currentSessionId,
      messages,
      events,
      streamingBubble,
      showStreamingBubble,
      blockingInteraction,
    }),
    [blockingInteraction, currentSessionId, events, messages, showStreamingBubble, streamingBubble],
  )
  const renderChatItem = useCallback(
    (item: ChatRenderItem<ChatMsg>) => {
      if (item.kind === 'group') return <ChatBubble group={item.group} agent={chatAgent} isStreaming={false} />
      if (item.kind === 'streaming') {
        return <ChatBubble message={item.message} agent={chatAgent} isStreaming footer={interactionPanel} liveElapsedSeconds={liveElapsedSeconds} />
      }
      if (item.kind === 'blocking') return <BlockingInteractionBar agent={chatAgent} panel={interactionPanel} />
      return (
        <ChatBubble
          message={item.message}
          agent={chatAgent}
          isStreaming={false}
          onLoadMessageProcess={fetchMessageProcess}
          onLoadMessageFileChanges={fetchMessageFileChanges}
          fileChangeDetailsByMessageId={fileChangeDetailsByMessageId}
          fileChangeLoadingByKey={toolCallLoadingByKey}
          fileChangeErrorByKey={toolCallErrorByKey}
          turnProcessLoadingByMessageId={turnProcessLoadingByMessageId}
          turnProcessErrorByMessageId={turnProcessErrorByMessageId}
        />
      )
    },
    [chatAgent, fetchMessageFileChanges, fetchMessageProcess, fileChangeDetailsByMessageId, interactionPanel, liveElapsedSeconds, toolCallErrorByKey, toolCallLoadingByKey, turnProcessErrorByMessageId, turnProcessLoadingByMessageId],
  )

  const currentModeName =
    capabilities.modes.find((m) => m.modeId === capabilities.currentModeId)?.name || capabilities.currentModeId
  const currentModelName =
    capabilities.models.find((m) => m.modelId === capabilities.currentModelId)?.name || capabilities.currentModelId
  const secondaryConfigs = capabilities.configOptions.filter(
    (o) => o.category !== 'model' && o.category !== 'mode' && o.id !== 'model' && o.id !== 'mode',
  )

  useEffect(() => {
    if (blockingInteraction) requestAnimationFrame(() => scrollToBottom('smooth'))
  }, [blockingInteraction, pendingInteractionId, scrollToBottom])

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-1)' }}>
      {/* ─── Left Sidebar ─── */}
      <aside
        style={{
          width: 250,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-0)',
        }}
      >
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setSidebarTab('sessions')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              padding: '9px 0',
              border: 'none',
              borderBottom: sidebarTab === 'sessions' ? '2px solid var(--blue)' : '2px solid transparent',
              background: 'transparent',
              color: sidebarTab === 'sessions' ? 'var(--blue)' : 'var(--text-3)',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            <MessageSquareIcon size={14} /> 会话
          </button>
          <button
            type="button"
            onClick={() => setSidebarTab('files')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              padding: '9px 0',
              border: 'none',
              borderBottom: sidebarTab === 'files' ? '2px solid var(--blue)' : '2px solid transparent',
              background: 'transparent',
              color: sidebarTab === 'files' ? 'var(--blue)' : 'var(--text-3)',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            <FolderOpen size={14} /> 文件
          </button>
        </div>

        {sidebarTab === 'sessions' ? (
          <>
            <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {connected ? <Wifi size={12} color="var(--green)" /> : <WifiOff size={12} color="var(--red)" />}
              <span style={{ fontSize: 13, color: connected ? 'var(--green)' : 'var(--red)' }}>
                {connected ? '已连接' : '未连接'}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }}>
              <div
                style={{
                  padding: '6px 14px 4px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-3)',
                  letterSpacing: '0.04em',
                }}
              >
                智能体
              </div>
              {projectAgents.length === 0 && (
                <div
                  style={{
                    margin: '18px 14px',
                    padding: 14,
                    border: '1px dashed var(--border)',
                    borderRadius: 10,
                    background: 'var(--bg-1)',
                    textAlign: 'center',
                  }}
                >
                  <Bot size={26} color="var(--text-3)" style={{ marginBottom: 8, opacity: 0.5 }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', marginBottom: 5 }}>
                    当前项目暂无智能体
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 10 }}>
                    先从 Agent 广场添加到项目，再新建会话开始对话。
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/agents')}
                    style={{
                      border: 'none',
                      background: 'var(--blue)',
                      color: 'white',
                      cursor: 'pointer',
                      padding: '7px 12px',
                      borderRadius: 7,
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    添加智能体
                  </button>
                </div>
              )}
              {projectAgents.map((agent) => (
                <div key={agent.id} style={{ marginBottom: 2 }}>
                  <button
                    type="button"
                    onClick={() => toggleAgent(agent.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '7px 14px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-1)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {expandedAgentIds.has(agent.id) ? (
                      <ChevronDown size={13} color="var(--text-3)" />
                    ) : (
                      <ChevronRight size={13} color="var(--text-3)" />
                    )}
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: agentColor(agent),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'white',
                        flexShrink: 0,
                      }}
                    >
                      {agentAvatar(agent)}
                    </span>
                    <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{agent.name}</span>
                    <span
                      style={{
                        fontSize: 12,
                        padding: '1px 6px',
                        borderRadius: 10,
                        background: 'var(--bg-2)',
                        color: 'var(--text-3)',
                      }}
                    >
                      {agentSessions(agent.id).length}
                    </span>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: statusDot(agent.status),
                        flexShrink: 0,
                      }}
                      title={statusLabel(agent.status)}
                    />
                  </button>
                  {expandedAgentIds.has(agent.id) && (
                    <>
                      {agentSessions(agent.id).map((s) => {
                        const indicator = sessionIndicator(s, runningSessionIds, unreadSessionIds)
                        return (
                          <div
                            key={s.id}
                            style={{
                              position: 'relative',
                              display: 'flex',
                              alignItems: 'center',
                              paddingLeft: 42,
                              paddingRight: 8,
                              background: currentSessionId === s.id ? 'var(--blue-light)' : 'transparent',
                              borderRadius: 4,
                            }}
                          >
                          <button
                            type="button"
                            onClick={() => handleSelectSession(agent.id, s.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              flex: 1,
                              minWidth: 0,
                              padding: '5px 0',
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--text-1)',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: indicator.color,
                                flexShrink: 0,
                                animation: indicator.pulse ? 'session-running-pulse 1s ease-in-out infinite' : undefined,
                                boxShadow: indicator.pulse ? '0 0 0 4px rgba(5, 150, 105, 0.12)' : undefined,
                              }}
                              title={indicator.title}
                            />
                            <span
                              style={{
                                flex: 1,
                                fontSize: 14,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {sessionTitle(s)}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                              {formatTime(s.last_message_at || s.updated_at || s.started_at)}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSessionMenuId(sessionMenuId === s.id ? null : s.id)
                            }}
                            title="会话操作"
                            style={{
                              width: 22,
                              height: 22,
                              border: 'none',
                              borderRadius: 4,
                              background: 'transparent',
                              color: 'var(--text-3)',
                              cursor: 'pointer',
                              fontSize: 16,
                              lineHeight: 1,
                            }}
                          >
                            ⋯
                          </button>
                          {sessionMenuId === s.id && (
                            <div
                              style={{
                                position: 'absolute',
                                right: 8,
                                top: 28,
                                zIndex: 20,
                                width: 120,
                                padding: 4,
                                background: 'var(--bg-0)',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                boxShadow: 'var(--shadow-lg)',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => handleRenameSession(s.id, sessionTitle(s))}
                                style={sessionMenuItemStyle}
                              >
                                重命名
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCloseSession(s.id)}
                                style={sessionMenuItemStyle}
                              >
                                关闭
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopySession(agent.id, s.id)}
                                style={sessionMenuItemStyle}
                              >
                                复制
                              </button>
                              <button
                                type="button"
                                onClick={() => handleArchiveSession(s.id)}
                                style={sessionMenuItemStyle}
                              >
                                归档
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSession(s.id)}
                                style={{ ...sessionMenuItemStyle, color: 'var(--red)' }}
                              >
                                删除
                              </button>
                            </div>
                          )}
                          </div>
                        )
                      })}
                      <button
                        type="button"
                        onClick={() => handleNewSession(agent.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          width: '100%',
                          padding: '5px 14px 5px 42px',
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--text-3)',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        <Plus size={12} /> 新建会话
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', minHeight: 0 }}>
            {!currentProjectId ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 15 }}>
                <FolderOpen size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                <p>请先在顶部选择一个项目</p>
              </div>
            ) : fileTree.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 15 }}>
                <FolderOpen size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                <p>加载文件中...</p>
              </div>
            ) : (
              <FileTree
                entries={fileTree}
                selectedPath={openFile?.path ?? null}
                onSelectFile={(path) => currentProjectId && openFileByPath(currentProjectId, path)}
                onExpandDir={(path) => currentProjectId && expandDir(currentProjectId, path)}
              />
            )}
          </div>
        )}
      </aside>

      {/* ─── File Preview (optional) ─── */}
      {openFile && (
        <div style={{ width: 420, flexShrink: 0 }}>
          <FilePreview file={openFile} onClose={closeFile} />
        </div>
      )}

      {/* ─── Center Chat ─── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <header
          style={{
            padding: '10px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-0)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {chatAgent && (
              <>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: agentColor(chatAgent),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'white',
                  }}
                >
                  {agentAvatar(chatAgent)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{chatAgent.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                    {chatAgent.runtime} · {statusLabel(chatAgent.status)}
                  </div>
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {currentSessionId && (
              <button
                onClick={() => setShowTimeline((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 11px',
                  borderRadius: 7,
                  border: `1px solid ${showTimeline ? '#93b4f5' : 'var(--border)'}`,
                  background: showTimeline ? '#eff6ff' : 'var(--bg-0)',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: showTimeline ? '#2563eb' : 'var(--text-2)',
                  transition: 'all .15s',
                }}
              >
                📋 时间线
              </button>
            )}
          </div>
        </header>
        {showTimeline && currentSessionId && (
          <div style={{ position: 'relative' }}>
            <TimelinePopover sessionId={currentSessionId} onClose={() => setShowTimeline(false)} />
          </div>
        )}

        {showPlanBar && (
          <PlanBar
            plan={plan}
            isStreaming={isStreaming}
            currentModeId={capabilities.currentModeId}
            modes={capabilities.modes}
            onSetMode={setMode}
          />
        )}

        {/* Messages */}
        <div ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {!currentSessionId ? (
            <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '80px 20px' }}>
              <Bot size={48} color="var(--text-3)" style={{ marginBottom: 16, opacity: 0.3 }} />
              <div style={{ fontSize: 15, marginBottom: 8 }}>选择一个 Session 或新建会话</div>
              <div style={{ fontSize: 14 }}>点击左侧 Agent 下方的会话开始</div>
            </div>
          ) : (
            <div
              key={chatContentKey(currentSessionId)}
              style={{ padding: '20px 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {chatItems.length === 0 && !showStreamingBubble && !blockingInteraction && (
                <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '48px 0' }}>
                  暂无消息，开始对话吧
                </div>
              )}
              <VirtualChatList
                key={currentSessionId}
                items={chatItems}
                getKey={(item) => item.id}
                renderItem={renderChatItem}
                scrollRef={chatScrollRef}
                onContentResize={handleChatContentResize}
              />
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* ─── Codex-style Input Card ─── */}
        <div style={{ padding: '0 20px 16px', flexShrink: 0 }}>
          {/* Image previews */}
          {pendingImages.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {pendingImages.map((img, i) => (
                <div
                  key={i}
                  style={{
                    position: 'relative',
                    width: 52,
                    height: 52,
                    borderRadius: 6,
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                  }}
                >
                  <img src={img.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button
                    type="button"
                  onClick={() => removePendingImage(i)}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)',
                      border: 'none',
                      color: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: draggingImages ? '1px solid var(--blue)' : '1px solid var(--border)',
              borderRadius: 12,
              background: draggingImages ? 'var(--blue-light)' : 'var(--bg-0)',
              boxShadow: draggingImages ? '0 0 0 3px rgba(37,99,235,0.12)' : '0 1px 4px rgba(0,0,0,0.06)',
              overflow: 'hidden',
              opacity: currentSessionId ? 1 : 0.5,
            }}
          >
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value)
                autoResize()
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                blockingInteraction ? '等待你确认后继续...' : currentSessionId ? '输入消息...' : '先选择一个 Session'
              }
              disabled={!currentSessionId || !connected || blockingInteraction}
              autoFocus
              rows={2}
              style={{
                width: '100%',
                padding: '14px 16px 8px',
                border: 'none',
                outline: 'none',
                resize: 'none',
                background: 'transparent',
                color: 'var(--text-1)',
                fontSize: 15,
                lineHeight: 1.6,
                fontFamily: 'inherit',
                minHeight: 56,
                maxHeight: 160,
                boxSizing: 'border-box',
              }}
            />
            {/* Bottom toolbar (inside the card) */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px 10px', gap: 4 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!currentSessionId}
                title="添加附件"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-3)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Paperclip size={15} />
              </button>

              {capabilities.commands.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => openMenu('command', e)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--bg-1)',
                    color: 'var(--text-2)',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  <Wrench size={12} /> 命令 <ChevronDown size={10} />
                </button>
              )}

              {capabilities.modes.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => openMenu('mode', e)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--bg-1)',
                    color: 'var(--text-2)',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  <Settings2 size={12} /> {modeCn(currentModeName)} <ChevronDown size={10} />
                </button>
              )}

              <div style={{ flex: 1 }} />

              {secondaryConfigs.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={(e) => openMenu(`config:${opt.id}`, e)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--bg-1)',
                    color: 'var(--text-2)',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {configLabel(opt)} <ChevronDown size={10} />
                </button>
              ))}

              {usage && <MiniContextCircle used={usage.contextUsed} total={usage.contextSize} />}

              {capabilities.models.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => openMenu('model', e)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-2)',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {currentModelName || '模型'} <ChevronDown size={10} />
                </button>
              )}

              {blockingInteraction && (
                <span style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600, marginRight: 6 }}>等待确认</span>
              )}

              {isStreaming ? (
                <button
                  type="button"
                  onClick={cancelTurn}
                  title="停止生成"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: '2px solid var(--red)',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: 'var(--red)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                >
                  <Square size={14} fill="var(--red)" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSendPrompt}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: 'none',
                    cursor: canSendPrompt ? 'pointer' : 'default',
                    background: canSendPrompt ? 'var(--text-1)' : 'var(--bg-3)',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background 0.15s',
                  }}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Right Sidebar: session context */}
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid var(--border)',
          background: 'var(--bg-0)',
        }}
      >
        {teamContext.team ? (
          <TeamContextPanel
            context={teamContext}
            agents={projectAgents}
            currentSessionId={currentSessionId}
            onSelectMember={handleSelectSession}
          />
        ) : (
          <>
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: 15,
                fontWeight: 600,
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ListTodo size={14} /> 任务
              </div>
              <button
                type="button"
                onClick={() => setShowNewTask(true)}
                style={{
                  border: 'none',
                  background: 'var(--blue)',
                  color: 'white',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Plus size={12} /> 新建
              </button>
            </div>
            <TaskPanel tasks={tasks} agents={projectAgents} />
          </>
        )}
      </aside>

      {showNewTask && (
        <NewTaskModal
          agents={projectAgents}
          onCreate={(title, desc, agentId) => createTask(title, desc, agentId, currentProjectId ?? undefined)}
          onClose={() => setShowNewTask(false)}
        />
      )}

      {/* 命令菜单 */}
      {showCommandMenu && (
        <DropdownPortal onClose={() => setShowCommandMenu(false)} style={menuStyle(menuAnchor, 320)}>
          {capabilities.commands.map((cmd) => (
            <button
              key={cmd.name}
              type="button"
              onClick={() => {
                setInputValue(`/${cmd.name} `)
                setShowCommandMenu(false)
                textareaRef.current?.focus()
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                width: '100%',
                minWidth: 0,
                padding: '10px 14px',
                border: 'none',
                borderRadius: 8,
                background: 'transparent',
                color: 'var(--text-1)',
                fontSize: 14,
                cursor: 'pointer',
                textAlign: 'left',
                boxSizing: 'border-box',
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                /{cmd.name}
              </span>
              <span
                style={{
                  color: 'var(--text-3)',
                  fontSize: 12,
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                  lineHeight: 1.4,
                }}
              >
                {cmd.description || cmd.input?.hint || '插入命令'}
              </span>
            </button>
          ))}
        </DropdownPortal>
      )}

      {/* 模式菜单 */}
      {showModeMenu && (
        <DropdownPortal onClose={() => setShowModeMenu(false)} style={menuStyle(menuAnchor, 260)}>
          {capabilities.modes.map((m) => {
            const active = m.modeId === capabilities.currentModeId
            return (
              <button
                key={m.modeId}
                type="button"
                onClick={() => {
                  setMode(m.modeId)
                  setShowModeMenu(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 14px',
                  border: 'none',
                  borderRadius: 8,
                  background: active ? 'var(--blue-light)' : 'transparent',
                  color: 'var(--text-1)',
                  fontSize: 14,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {active ? (
                  <Check size={13} color="var(--blue)" style={{ flexShrink: 0 }} />
                ) : (
                  <Circle size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{modeCn(m.name)}</div>
                  {m.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{m.description}</div>
                  )}
                </div>
              </button>
            )
          })}
        </DropdownPortal>
      )}

      {/* 配置菜单 */}
      {showConfigMenu && (
        <DropdownPortal onClose={() => setShowConfigMenu(null)} style={menuStyle(menuAnchor, 240)}>
          {(() => {
            const opt = secondaryConfigs.find((o) => o.id === showConfigMenu)
            if (!opt) return null
            if (opt.type === 'boolean') {
              const active = opt.currentValue === true
              return (
                <button
                  type="button"
                  onClick={() => {
                    setConfig(opt.id, !active)
                    setShowConfigMenu(null)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 'none',
                    borderRadius: 8,
                    background: active ? 'var(--blue-light)' : 'transparent',
                    color: 'var(--text-1)',
                    fontSize: 14,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {active ? <Check size={13} color="var(--blue)" /> : <Circle size={13} color="var(--text-3)" />}{' '}
                  {opt.name}
                </button>
              )
            }
            return opt.options?.map((item) => {
              const active = item.value === opt.currentValue
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setConfig(opt.id, item.value)
                    setShowConfigMenu(null)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 'none',
                    borderRadius: 8,
                    background: active ? 'var(--blue-light)' : 'transparent',
                    color: 'var(--text-1)',
                    fontSize: 14,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {active ? (
                    <Check size={13} color="var(--blue)" style={{ flexShrink: 0 }} />
                  ) : (
                    <Circle size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{configOptionLabel(item.value, item.name)}</div>
                    {item.description && (
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{item.description}</div>
                    )}
                  </div>
                </button>
              )
            })
          })()}
        </DropdownPortal>
      )}

      {/* 模型菜单 */}
      {showModelMenu && (
        <DropdownPortal onClose={() => setShowModelMenu(false)} style={menuStyle(menuAnchor, 280)}>
          {capabilities.models.map((m) => {
            const active = m.modelId === capabilities.currentModelId
            return (
              <button
                key={m.modelId}
                type="button"
                onClick={() => {
                  setModel(m.modelId)
                  setShowModelMenu(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 14px',
                  border: 'none',
                  borderRadius: 8,
                  background: active ? 'var(--blue-light)' : 'transparent',
                  color: 'var(--text-1)',
                  fontSize: 15,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {active ? (
                  <Check size={13} color="var(--blue)" style={{ flexShrink: 0 }} />
                ) : (
                  <Circle size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
                )}
                <span style={{ fontWeight: active ? 600 : 400 }}>{m.name || m.modelId}</span>
              </button>
            )
          })}
        </DropdownPortal>
      )}
    </div>
  )
}

/* ─── Mini Context Circle (input toolbar) ─── */
function MiniContextCircle({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, (used / total) * 100)
  const r = 7,
    c = 2 * Math.PI * r,
    dash = (c * pct) / 100
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? '#f59e0b' : 'var(--blue)'
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
      title={`上下文: ${fmtTokens(used)} / ${fmtTokens(total)}`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--bg-3)" strokeWidth="2" />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeDashoffset={c * 0.25}
          strokeLinecap="round"
        />
      </svg>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
        {fmtTokens(used)}/{fmtTokens(total)}
      </span>
    </div>
  )
}

/* ─── Plan Bar ─── */
function PlanBar({
  plan,
  isStreaming,
  currentModeId,
  modes,
  onSetMode,
}: {
  plan: PlanEntry[]
  isStreaming: boolean
  currentModeId: string | null
  modes: { modeId: string; name: string; description?: string }[]
  onSetMode: (modeId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  const done = plan.filter((p) => p.status === 'completed').length
  const isPlanMode = currentModeId === 'plan' || modes.find((m) => m.modeId === currentModeId)?.name === 'Plan Mode'
  const defaultMode =
    modes.find((m) => m.modeId === 'default' || m.name === 'Default')?.modeId ||
    modes.find((m) => m.modeId !== currentModeId)?.modeId
  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-0)' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: '8px 20px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 14,
          color: 'var(--text-1)',
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <ListTodo size={13} color="var(--blue)" /> 计划 ({done}/{plan.length})
        {isPlanMode && (
          <span
            style={{
              marginLeft: 6,
              padding: '2px 7px',
              borderRadius: 999,
              background: 'var(--blue-light)',
              color: 'var(--blue)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            PLAN 模式
          </span>
        )}
        {isPlanMode && defaultMode && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              void onSetMode(defaultMode)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                void onSetMode(defaultMode)
              }
            }}
            style={{
              marginLeft: 'auto',
              padding: '4px 10px',
              borderRadius: 7,
              background: 'var(--text-1)',
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            切换到执行模式
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: '0 20px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {plan.length === 0 && (
            <div style={{ fontSize: 14, color: 'var(--text-3)' }}>
              计划模式已开启，Agent 会先给出计划；如需执行可切换到执行模式。
            </div>
          )}
          {plan.map((p, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                color:
                  p.status === 'completed'
                    ? 'var(--green)'
                    : p.status === 'in_progress' && isStreaming
                      ? 'var(--blue)'
                      : 'var(--text-3)',
              }}
            >
              {p.status === 'completed' ? (
                <CheckCircle2 size={12} />
              ) : p.status === 'in_progress' && isStreaming ? (
                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Circle size={12} />
              )}
              <span style={{ textDecoration: p.status === 'completed' ? 'line-through' : undefined }}>{p.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Task Panel with Tabs ─── */
const TASK_TABS: { key: string; label: string; icon: typeof ListTodo; filter: (t: TaskData) => boolean }[] = [
  { key: 'all', label: '全部', icon: ListTodo, filter: () => true },
  { key: 'backlog', label: '待办', icon: Circle, filter: (t) => t.status === 'backlog' },
  {
    key: 'active',
    label: '进行中',
    icon: Loader2,
    filter: (t) => ['executing', 'needs_input'].includes(t.status),
  },
  { key: 'needs_attention', label: '需处理', icon: Zap, filter: (t) => ['blocked', 'reviewing'].includes(t.status) },
  { key: 'done', label: '已完成', icon: CheckCircle2, filter: (t) => ['completed', 'cancelled'].includes(t.status) },
]

function taskStageLabel(s: string): string {
  return (
    {
      executing: '执行中',
      planning: '规划中',
      reviewing: '审查中',
      blocked: '已阻塞',
      completed: '已完成',
      backlog: '待办',
      cancelled: '已取消',
    }[s] ?? s
  )
}
function taskStageColor(s: string): string {
  return (
    {
      executing: 'var(--blue)',
      planning: 'var(--purple)',
      reviewing: '#f59e0b',
      blocked: 'var(--red)',
      completed: 'var(--green)',
      backlog: 'var(--text-3)',
    }[s] ?? 'var(--text-3)'
  )
}

function TaskPanel({ tasks, agents }: { tasks: TaskData[]; agents: AgentData[] }) {
  const [tab, setTab] = useState('all')
  const filtered = tasks.filter(TASK_TABS.find((t) => t.key === tab)!.filter)
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Tabs — 重新设计为 pill 样式 */}
      <div style={{ display: 'flex', gap: 4, padding: '10px 12px 6px', flexWrap: 'wrap' }}>
        {TASK_TABS.map((t) => {
          const count = tasks.filter(t.filter).length
          const active = tab === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 10px',
                borderRadius: 16,
                border: active ? '1px solid var(--blue)' : '1px solid var(--border)',
                background: active ? 'var(--blue-light)' : 'var(--bg-1)',
                color: active ? 'var(--blue)' : 'var(--text-3)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={11} />
              {t.label}
              {count > 0 && (
                <span
                  style={{
                    background: active ? 'var(--blue)' : 'var(--bg-3)',
                    color: active ? 'white' : 'var(--text-2)',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 10,
                    minWidth: 16,
                    textAlign: 'center',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 12px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--text-3)' }}>
            <Archive size={28} style={{ opacity: 0.2, marginBottom: 8 }} />
            <div style={{ fontSize: 14 }}>暂无{TASK_TABS.find((t) => t.key === tab)?.label}任务</div>
          </div>
        ) : (
          filtered.map((task) => {
            const ag = task.assigned_agent_id ? agentMap.get(task.assigned_agent_id) : null
            return (
              <div
                key={task.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-1)',
                  marginBottom: 6,
                  transition: 'box-shadow 0.15s',
                }}
              >
                <div
                  style={{ fontSize: 15, fontWeight: 500, marginBottom: 4, lineHeight: 1.4, color: 'var(--text-1)' }}
                >
                  {task.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'white',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: taskStageColor(task.status),
                    }}
                  >
                    {task.stage || taskStageLabel(task.status)}
                  </span>
                  {ag && (
                    <span
                      style={{
                        fontSize: 12,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: agentColor(ag),
                        color: 'white',
                        fontWeight: 500,
                      }}
                    >
                      {ag.name}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>
                    {formatTime(task.created_at)}
                  </span>
                </div>
                {task.description && (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-3)',
                      marginTop: 6,
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {task.description}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ─── Tool Call Panel ─── */
function ToolCallPanel({ tc }: { tc: ToolCallInfo; isStreaming: boolean }) {
  const isActive = tc.status === 'in_progress' || tc.status === 'pending'
  const [openOverride, setOpenOverride] = useState<'open' | 'closed' | null>(null)
  const prevStatusRef = useRef(tc.status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = tc.status
    if ((prev === 'in_progress' || prev === 'pending') && tc.status === 'completed') {
      setOpenOverride((cur) => (cur === 'open' ? 'open' : 'closed'))
    }
  }, [tc.status])
  const open = openOverride === 'open' || (openOverride !== 'closed' && isActive)
  const toggleOpen = () => setOpenOverride(open ? 'closed' : 'open')
  const statusColor = tc.status === 'completed' ? 'var(--green)' : tc.status === 'failed' ? 'var(--red)' : 'var(--blue)'
  const statusIcon =
    tc.status === 'completed' ? (
      <Check size={10} />
    ) : tc.status === 'failed' ? (
      <X size={10} />
    ) : (
      <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
    )
  const statusText =
    tc.status === 'completed'
      ? '完成'
      : tc.status === 'failed'
        ? '失败'
        : tc.status === 'in_progress'
          ? '执行中'
          : '等待'
  const summary = toolSummary(tc)

  return (
    <div
      style={{
        marginBottom: 6,
        borderRadius: 8,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        background: 'var(--bg-1)',
        maxWidth: '100%',
      }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        style={{
          width: '100%',
          padding: '8px 10px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          textAlign: 'left',
          fontSize: 14,
          color: 'var(--text-1)',
        }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
          {summary}
        </span>
        <span
          style={{
            color: statusColor,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 12,
            flexShrink: 0,
            fontWeight: 500,
          }}
        >
          {statusIcon} {statusText}
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: '6px 10px',
            borderTop: '1px solid var(--border)',
            fontSize: 13,
            minWidth: 0,
            overflowX: 'hidden',
          }}
        >
          {tc.locations && tc.locations.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {tc.locations.map((l, i) => (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    maxWidth: '100%',
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'var(--bg-2)',
                    fontSize: 12,
                    marginRight: 4,
                    color: 'var(--text-2)',
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    verticalAlign: 'bottom',
                  }}
                >
                  {l.path}
                  {l.line ? `:${l.line}` : ''}
                </span>
              ))}
            </div>
          )}
          {tc.rawInput != null && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>参数</div>
              <div
                style={{
                  background: 'var(--bg-2)',
                  padding: 8,
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre',
                  maxHeight: 120,
                  maxWidth: '100%',
                  overflow: 'auto',
                  color: 'var(--text-2)',
                  lineHeight: 1.5,
                }}
              >
                {typeof tc.rawInput === 'string'
                  ? tc.rawInput.slice(0, 500)
                  : JSON.stringify(tc.rawInput, null, 2).slice(0, 500)}
              </div>
            </div>
          )}
          {tc.content?.map((c, i) => (
            <div key={i} style={{ marginTop: 4 }}>
              {c.type === 'diff' && c.path && (
                <div
                  style={{
                    background: 'var(--bg-2)',
                    padding: 8,
                    borderRadius: 6,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    whiteSpace: 'pre',
                    maxHeight: 200,
                    maxWidth: '100%',
                    overflow: 'auto',
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ color: 'var(--text-3)', marginBottom: 3 }}>{c.path}</div>
                  {c.oldText && <div style={{ color: 'var(--red)' }}>- {c.oldText.slice(0, 200)}</div>}
                  {c.newText && <div style={{ color: 'var(--green)' }}>+ {c.newText.slice(0, 200)}</div>}
                </div>
              )}
              {c.type === 'text' && c.text && (
                <div
                  style={{
                    background: 'var(--bg-2)',
                    padding: 8,
                    borderRadius: 6,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    maxHeight: 150,
                    maxWidth: '100%',
                    overflow: 'auto',
                    color: 'var(--text-2)',
                    lineHeight: 1.5,
                  }}
                >
                  {c.text.slice(0, 500)}
                </div>
              )}
            </div>
          ))}
          {tc.terminalOutput && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>终端输出</div>
              <div
                style={{
                  background: '#0f172a',
                  color: '#e2e8f0',
                  padding: 8,
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre',
                  maxHeight: 160,
                  maxWidth: '100%',
                  overflow: 'auto',
                  lineHeight: 1.5,
                }}
              >
                {tc.terminalOutput.slice(-2000)}
              </div>
            </div>
          )}
          {tc.progress && tc.progress.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>进度</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {tc.progress.slice(-6).map((p, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    • {p}
                  </div>
                ))}
              </div>
            </div>
          )}
          {tc.rawOutput != null && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>结果</div>
              <div
                style={{
                  background: 'var(--bg-2)',
                  padding: 8,
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre',
                  maxHeight: 120,
                  maxWidth: '100%',
                  overflow: 'auto',
                  color: 'var(--text-2)',
                  lineHeight: 1.5,
                }}
              >
                {typeof tc.rawOutput === 'string'
                  ? tc.rawOutput.slice(0, 500)
                  : JSON.stringify(tc.rawOutput, null, 2).slice(0, 500)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BlockingInteractionBar({ agent, panel }: { agent: AgentData | undefined; panel: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: agent ? agentColor(agent) : 'var(--bg-3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Bot size={14} color="white" />
      </div>
      <div style={{ width: 'min(760px, 75%)', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{agent?.name || 'Agent'}</span>
          <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>等待确认</span>
        </div>
        {panel}
      </div>
    </div>
  )
}

function InteractionPanel({
  permission,
  elicitation,
  onRespondPermission,
  onRespondElicitation,
}: {
  permission?: PermissionRequestInfo
  elicitation?: ElicitationRequestInfo
  onRespondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  onRespondElicitation: (
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, string | number | boolean | string[]>,
  ) => Promise<void>
}) {
  return (
    <>
      {permission && <PermissionCard request={permission} onRespond={onRespondPermission} />}
      {!permission && elicitation && (
        <ElicitationCard key={elicitation.id} request={elicitation} onRespond={onRespondElicitation} />
      )}
    </>
  )
}

function PermissionCard({
  request,
  onRespond,
}: {
  request: PermissionRequestInfo
  onRespond: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)
  const respond = async (optionId?: string, cancelled?: boolean) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onRespond(request.id, optionId, cancelled)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        border: '1px solid rgba(37,99,235,0.25)',
        borderRadius: '2px 12px 12px 12px',
        background: 'var(--bg-0)',
        boxShadow: 'var(--shadow-sm)',
        padding: 14,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: 'var(--blue-light)',
            color: 'var(--blue)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Wrench size={16} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>需要确认工具调用</div>
          <div style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 3 }}>
            Agent 正在等待你的权限决定，确认前本轮会暂停。
          </div>
        </div>
        <span
          style={{
            padding: '3px 8px',
            borderRadius: 999,
            background: '#fef2f2',
            color: 'var(--red)',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          阻塞中
        </span>
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto', marginBottom: 10 }}>
        <ToolCallPanel tc={request.toolCall} isStreaming={false} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {request.options.map((opt) => {
          const allow = isAllowPermissionOption(opt)
          const rejectAlways = isRejectAlwaysOption(opt)
          return (
            <button
              key={opt.optionId}
              type="button"
              disabled={submitting}
              title={opt.name}
              onClick={() => respond(opt.optionId)}
              style={{
                padding: '8px 13px',
                borderRadius: 8,
                border: allow ? 'none' : '1px solid var(--border)',
                background: allow ? 'var(--blue)' : rejectAlways ? '#fef2f2' : 'var(--bg-1)',
                color: allow ? 'white' : rejectAlways ? 'var(--red)' : 'var(--text-2)',
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting ? 'default' : 'pointer',
              }}
            >
              {permissionOptionLabel(opt)}
            </button>
          )
        })}
        <button
          type="button"
          disabled={submitting}
          onClick={() => respond(undefined, true)}
          style={{
            padding: '8px 13px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-1)',
            color: 'var(--text-3)',
            fontSize: 14,
            fontWeight: 600,
            cursor: submitting ? 'default' : 'pointer',
          }}
        >
          取消本次
        </button>
      </div>
    </div>
  )
}

function ElicitationCard({
  request,
  onRespond,
}: {
  request: ElicitationRequestInfo
  onRespond: (
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, string | number | boolean | string[]>,
  ) => Promise<void>
}) {
  const schema = request.requestedSchema as ElicitationSchema | undefined
  const props = schema?.properties || {}
  const [values, setValues] = useState<Record<string, ElicitationValue>>(() => getInitialElicitationValues(schema))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const validation = validateElicitationValues(schema, values)
    setErrors(validation.errors)
    if (!validation.ok || submitting) return
    setSubmitting(true)
    try {
      await onRespond(request.id, 'accept', values)
    } finally {
      setSubmitting(false)
    }
  }
  const respond = async (action: 'decline' | 'cancel') => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onRespond(request.id, action)
    } finally {
      setSubmitting(false)
    }
  }

  if (schema?.url) {
    return (
      <div
        style={{
          border: '1px solid rgba(37,99,235,0.25)',
          borderRadius: '2px 12px 12px 12px',
          background: 'var(--bg-0)',
          boxShadow: 'var(--shadow-sm)',
          padding: 14,
          maxWidth: '100%',
          overflow: 'hidden',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Agent 请求你打开页面</div>
        {request.message && (
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8, lineHeight: 1.5 }}>
            {request.message}
          </div>
        )}
        <a
          href={schema.url}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'block', fontSize: 14, color: 'var(--blue)', overflowWrap: 'anywhere', marginBottom: 12 }}
        >
          {schema.url}
        </a>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            style={{
              padding: '8px 13px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--blue)',
              color: 'white',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            我已完成
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => respond('cancel')}
            style={{
              padding: '8px 13px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--text-3)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        border: '1px solid rgba(37,99,235,0.25)',
        borderRadius: '2px 12px 12px 12px',
        background: 'var(--bg-0)',
        boxShadow: 'var(--shadow-sm)',
        padding: 14,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: 'var(--blue-light)',
            color: 'var(--blue)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <MessageSquareIcon size={16} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Agent 提问</div>
          {request.message && (
            <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>{request.message}</div>
          )}
        </div>
      </div>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 320, overflow: 'auto', paddingRight: 2 }}
      >
        {Object.entries(props).map(([key, prop]) => {
          const options = getElicitationOptions(prop)
          const label = prop.title || key
          const required = schema?.required?.includes(key)
          return (
            <label
              key={key}
              style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: 'var(--text-3)' }}
            >
              <span style={{ fontWeight: 600 }}>
                {label}
                {required && <span style={{ color: 'var(--red)' }}> *</span>}
              </span>
              {prop.description && <span style={{ fontSize: 12, lineHeight: 1.4 }}>{prop.description}</span>}
              {prop.type === 'boolean' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-2)', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={values[key] === true}
                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.checked }))}
                  />{' '}
                  是
                </span>
              ) : prop.type === 'array' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {options.map((item) => {
                    const selected = Array.isArray(values[key]) && (values[key] as string[]).includes(item.value)
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() =>
                          setValues((v) => {
                            const cur = Array.isArray(v[key]) ? (v[key] as string[]) : []
                            return {
                              ...v,
                              [key]: selected ? cur.filter((x) => x !== item.value) : [...cur, item.value],
                            }
                          })
                        }
                        style={{
                          padding: '6px 9px',
                          borderRadius: 999,
                          border: selected ? '1px solid var(--blue)' : '1px solid var(--border)',
                          background: selected ? 'var(--blue-light)' : 'var(--bg-1)',
                          color: selected ? 'var(--blue)' : 'var(--text-2)',
                          fontSize: 14,
                          cursor: 'pointer',
                        }}
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              ) : options.length > 0 ? (
                <select
                  value={String(values[key] ?? '')}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 7,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-1)',
                    color: 'var(--text-1)',
                  }}
                >
                  <option value="">请选择</option>
                  {options.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={prop.type === 'number' || prop.type === 'integer' ? 'number' : 'text'}
                  value={String(values[key] ?? '')}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [key]:
                        prop.type === 'number' || prop.type === 'integer' ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  style={{
                    padding: '8px 10px',
                    borderRadius: 7,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-1)',
                    color: 'var(--text-1)',
                  }}
                />
              )}
              {errors[key] && <span style={{ color: 'var(--red)', fontSize: 12 }}>{errors[key]}</span>}
            </label>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          type="button"
          disabled={submitting}
          onClick={submit}
          style={{
            padding: '8px 13px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--blue)',
            color: 'white',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          提交
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => respond('decline')}
          style={{
            padding: '8px 13px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-1)',
            color: 'var(--text-2)',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          拒绝
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => respond('cancel')}
          style={{
            padding: '8px 13px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-1)',
            color: 'var(--text-3)',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          取消
        </button>
      </div>
    </div>
  )
}

/* ─── Chat Bubble ─── */
type ChatMsg = {
  id: string
  session_id?: string
  role: string
  content: string
  thinking?: string | null
  tool_calls_json?: string | null
  decision_json?: string | null
  attachments_json?: string | null
  file_changes_json?: string | null
  has_tool_calls?: boolean
  tool_call_count?: number
  process_item_count?: number
  has_file_changes?: boolean
  file_change_count?: number
  parsedFileChanges?: FileChangeSummaryInfo
  parsedToolCalls?: ToolCallInfo[]
  parsedAttachments?: ImageAttachmentInfo[]
  parsedDecision?: Record<string, unknown> | null
  toolCalls?: ToolCallInfo[]
  processBlocks?: TurnProcessBlock[]
  finalAnswer?: string
  processDefaultOpen?: boolean
  stage?: string
  timestamp?: string
  streaming?: boolean
}
type ChatBubbleInput = ChatMsg | ChatTimelineGroup
type ChatBubbleBlock = ChatTimelineItem | ChatMsg

interface TurnStats {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedReadTokens?: number
  thoughtTokens?: number
  costAmount?: number
  elapsedSeconds?: number
}
const statChipStyle: React.CSSProperties = {
  padding: '3px 8px',
  borderRight: '1px solid var(--border)',
  fontSize: 12,
  whiteSpace: 'nowrap',
  display: 'flex',
  alignItems: 'center',
  gap: 3,
}

function parseJsonArray<T>(raw?: string | null): T[] {
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function parseJsonObject<T>(raw: string): T | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function ChatBubble({
  message,
  group,
  agent,
  isStreaming,
  footer,
  liveElapsedSeconds,
  onLoadMessageProcess,
  onLoadMessageFileChanges,
  fileChangeDetailsByMessageId = {},
  fileChangeLoadingByKey = {},
  fileChangeErrorByKey = {},
  turnProcessLoadingByMessageId = {},
  turnProcessErrorByMessageId = {},
}: {
  message?: ChatMsg
  group?: ChatTimelineGroup
  agent: AgentData | undefined
  isStreaming: boolean
  footer?: React.ReactNode
  liveElapsedSeconds?: number
  onLoadMessageProcess?: (sessionId: string, messageId: string) => void
  onLoadMessageFileChanges?: (sessionId: string, messageId: string) => void
  fileChangeDetailsByMessageId?: Record<string, FileChangeDetailInfo>
  fileChangeLoadingByKey?: Record<string, boolean>
  fileChangeErrorByKey?: Record<string, string>
  turnProcessLoadingByMessageId?: Record<string, boolean>
  turnProcessErrorByMessageId?: Record<string, string>
}) {
  const normalizedMessage: ChatBubbleInput = group || message || { id: 'empty', role: 'system', content: '' }
  const isTimelineGroup = 'blocks' in normalizedMessage
  const role = normalizedMessage.role
  const timestamp = normalizedMessage.timestamp
  let streaming = false
  let stage: string | undefined

  const blocks: ChatBubbleBlock[] = isTimelineGroup ? normalizedMessage.blocks : [normalizedMessage]
  const lastTimelineMessageBlock = isTimelineGroup
    ? [...normalizedMessage.blocks]
        .reverse()
        .find((block): block is Extract<ChatTimelineItem, { kind: 'message' }> => block.kind === 'message')
    : null
  const timelineTurnStats: TurnStats | null = lastTimelineMessageBlock?.turnStats
    ? { ...lastTimelineMessageBlock.turnStats }
    : null
  const messageTurnStats = !isTimelineGroup && normalizedMessage.decision_json
    ? parseJsonObject<TurnStats>(normalizedMessage.decision_json)
    : null
  let turnStats: TurnStats | null = isTimelineGroup ? timelineTurnStats : messageTurnStats

  if (!isTimelineGroup) {
    streaming = normalizedMessage.streaming || false
    stage = normalizedMessage.stage
  }

  const isHuman = role === 'human'
  if (isHuman) turnStats = null
  const elapsedSeconds = turnStats?.elapsedSeconds ?? (streaming ? liveElapsedSeconds : undefined)
  const showTurnStats = !!turnStats || (!isHuman && streaming && elapsedSeconds != null)
  const visibleBlocks = blocks.filter(chatBubbleBlockHasBody)
  const turnProcessBlocks = !isTimelineGroup ? normalizedMessage.processBlocks || [] : []
  const processCount = !isTimelineGroup ? (normalizedMessage.process_item_count ?? normalizedMessage.tool_call_count ?? 0) : 0
  const canLoadTurnProcess = !isTimelineGroup && !streaming && role === 'agent' && !!normalizedMessage.session_id && processCount > 0 && !normalizedMessage.processBlocks
  const turnFinalAnswer = !isTimelineGroup ? (normalizedMessage.finalAnswer ?? (canLoadTurnProcess ? normalizedMessage.content : undefined)) : undefined
  const hasTurnModel = !isTimelineGroup && (turnProcessBlocks.length > 0 || turnFinalAnswer != null || canLoadTurnProcess)
  const processLoading = !isTimelineGroup ? turnProcessLoadingByMessageId[normalizedMessage.id] : false
  const processError = !isTimelineGroup ? turnProcessErrorByMessageId[normalizedMessage.id] : undefined
  const fileChangesSummary = !isTimelineGroup
    ? normalizedMessage.parsedFileChanges || (normalizedMessage.file_changes_json ? parseJsonObject<FileChangeSummaryInfo>(normalizedMessage.file_changes_json) ?? undefined : undefined)
    : undefined
  const fileChangesDetail = !isTimelineGroup ? fileChangeDetailsByMessageId[normalizedMessage.id] : undefined
  const fileChangesLoading = !isTimelineGroup ? !!fileChangeLoadingByKey[`file:${normalizedMessage.id}`] : false
  const fileChangesError = !isTimelineGroup ? fileChangeErrorByKey[`file:${normalizedMessage.id}`] : undefined
  const loadTurnProcess = canLoadTurnProcess && !isTimelineGroup && normalizedMessage.session_id
    ? () => onLoadMessageProcess?.(normalizedMessage.session_id!, normalizedMessage.id)
    : undefined
  const loadFileChanges = !isTimelineGroup && normalizedMessage.session_id && normalizedMessage.has_file_changes
    ? () => onLoadMessageFileChanges?.(normalizedMessage.session_id!, normalizedMessage.id)
    : undefined
  const hasBody = hasTurnModel || visibleBlocks.length > 0 || !!footer
  const streamingLabel = stage || '生成中'

  return (
    <div data-bubble style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: isHuman ? 'row-reverse' : 'row' }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: isHuman ? 'var(--bg-3)' : agent ? agentColor(agent) : 'var(--bg-3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isHuman ? <User size={14} color="var(--text-2)" /> : <Bot size={14} color="white" />}
      </div>
      <div style={{ maxWidth: '75%', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 4,
            flexDirection: isHuman ? 'row-reverse' : 'row',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>{isHuman ? '你' : agent?.name || 'Agent'}</span>
          {timestamp && (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatTime(timestamp)}</span>
          )}
          {streaming && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--blue)' }}>
              <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> {streamingLabel}
            </span>
          )}
        </div>
        {hasBody && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: isHuman ? '12px 2px 12px 12px' : '2px 12px 12px 12px',
              background: isHuman ? 'var(--blue-light)' : 'var(--bg-0)',
              border: `1px solid ${isHuman ? 'rgba(37,99,235,0.15)' : 'var(--border)'}`,
              boxShadow: 'var(--shadow-sm)',
              maxWidth: '100%',
              overflow: 'hidden',
            }}
          >
            {hasTurnModel ? (
              <TurnContentView
                processBlocks={turnProcessBlocks}
                finalAnswer={turnFinalAnswer || ''}
                isStreaming={isStreaming}
                fallbackStage={stage}
                processCount={processCount}
                processLoaded={!canLoadTurnProcess}
                processLoading={processLoading}
                processError={processError}
                fileChangesSummary={fileChangesSummary}
                fileChangesDetail={fileChangesDetail}
                fileChangesLoading={fileChangesLoading}
                fileChangesError={fileChangesError}
                defaultProcessOpen={streaming || !!normalizedMessage.processDefaultOpen}
                onLoadProcess={loadTurnProcess}
                onLoadFileChanges={loadFileChanges}
                renderProcessBlock={(block) => <ProcessBlockView key={block.id} block={block} isStreaming={isStreaming} />}
              />
            ) : visibleBlocks.map((block, index) => (
                <ChatBubbleBlockView
                  key={bubbleBlockKey(block, index)}
                  block={block}
                  isLast={index === visibleBlocks.length - 1}
                  isStreaming={isStreaming}
                />
              ))}
            {footer && <div style={{ marginTop: 10 }}>{footer}</div>}
          </div>
        )}
        {/* 单次统计 */}
        {showTurnStats && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0,
              marginTop: 6,
              fontSize: 12,
              color: 'var(--text-3)',
              background: 'var(--bg-2)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {elapsedSeconds != null && (
              <span style={{ ...statChipStyle, fontWeight: 600, color: 'var(--text-2)' }}>
                {streaming ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', verticalAlign: -2, marginRight: 4 }} /> : '⏱ '}
                {formatCompactDuration(elapsedSeconds)}
              </span>
            )}
            {turnStats && (
              <>
                <span style={statChipStyle}>
                  <span style={{ color: 'var(--text-3)' }}>输入</span>{' '}
                  <b style={{ color: 'var(--text-2)' }}>{fmtTokens(turnStats.inputTokens)}</b>
                </span>
                <span style={statChipStyle}>
                  <span style={{ color: 'var(--text-3)' }}>输出</span>{' '}
                  <b style={{ color: 'var(--text-2)' }}>{fmtTokens(turnStats.outputTokens)}</b>
                </span>
              </>
            )}
            {turnStats?.cachedReadTokens != null && turnStats.cachedReadTokens > 0 && (
              <span style={statChipStyle}>
                <span style={{ color: 'var(--text-3)' }}>缓存</span>{' '}
                <b style={{ color: 'var(--text-2)' }}>{fmtTokens(turnStats.cachedReadTokens)}</b>
              </span>
            )}
            {turnStats?.costAmount != null && (
              <span style={{ ...statChipStyle, borderRight: 'none' }}>${turnStats.costAmount.toFixed(4)}</span>
            )}
          </div>
        )}
        <TurnFileChangesSummary
          processBlocks={turnProcessBlocks}
          fileChangesSummary={fileChangesSummary}
          fileChangesDetail={fileChangesDetail}
          isStreaming={isStreaming}
        />
      </div>
    </div>
  )
}

function TurnFileChangesSummary({
  processBlocks,
  fileChangesSummary,
  fileChangesDetail,
  isStreaming,
}: {
  processBlocks: TurnProcessBlock[]
  fileChangesSummary?: FileChangeSummaryInfo
  fileChangesDetail?: FileChangeDetailInfo
  isStreaming: boolean
}) {
  const changes = useMemo(() => {
    if (fileChangesDetail?.files.length) return fileChangesDetail
    if (fileChangesSummary?.files.length) return fileChangesFromSummary(fileChangesSummary)
    return extractTurnFileChanges(processBlocks)
  }, [fileChangesDetail, fileChangesSummary, processBlocks])
  const ref = useRef<HTMLDivElement>(null)
  if (changes.files.length === 0) return null

  const handleClick = () => {
    const bubble = ref.current?.closest('[data-bubble]')
    const card = bubble?.querySelector('[data-file-changes-card]')
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <div
      ref={ref}
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 6,
        fontSize: 12,
        color: 'var(--text-3)',
        background: 'var(--bg-2)',
        borderRadius: 6,
        padding: '4px 10px',
        marginLeft: 6,
        cursor: 'pointer',
      }}
    >
      <FileText size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
      <span style={{ color: 'var(--primary)', fontWeight: 500 }}>
        {isStreaming ? '正在修改' : '修改'} {changes.files.length} 个文件
      </span>
      <span style={{ color: 'var(--green)', fontWeight: 600 }}>+{changes.totalAdded}</span>
      <span style={{ color: 'var(--red)', fontWeight: 600 }}>-{changes.totalDeleted}</span>
    </div>
  )
}

function bubbleBlockKey(block: ChatBubbleBlock, index: number): string {
  return `${block.id}-${index}`
}

function chatBubbleBlockHasBody(block: ChatBubbleBlock): boolean {
  if ('kind' in block) {
    if (block.kind === 'tool') return true
    return !!block.content || !!block.thinking || (block.attachments?.length || 0) > 0
  }

  const toolCalls = block.toolCalls || block.parsedToolCalls || parseJsonArray<ToolCallInfo>(block.tool_calls_json)
  const attachments = block.parsedAttachments || parseJsonArray<ImageAttachmentInfo>(block.attachments_json)
  return !!block.content || !!block.thinking || attachments.length > 0 || toolCalls.length > 0 || !!block.has_tool_calls
}

function ProcessBlockView({ block, isStreaming }: { block: TurnProcessBlock; isStreaming: boolean }) {
  if (block.kind === 'tool') {
    const diffEntries = toolBlockHasDiff(block.toolCall)
      ? extractFileChangesFromToolCall(block.toolCall)
      : []
    return (
      <>
        <ToolCallPanel tc={block.toolCall} isStreaming={isStreaming} />
        {diffEntries.length > 0 && (
          <FileChangesCard
            changes={{
              files: diffEntries,
              totalAdded: diffEntries.reduce((s, f) => s + f.addedLines, 0),
              totalDeleted: diffEntries.reduce((s, f) => s + f.deletedLines, 0),
            }}
            compact
          />
        )}
      </>
    )
  }
  if (block.kind === 'thinking') {
    return (
      <div style={{ borderRadius: 6, background: 'var(--bg-2)', padding: '8px 10px', color: 'var(--text-2)', fontSize: 14, lineHeight: 1.6, fontStyle: 'italic', overflowWrap: 'anywhere' }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>思考过程</div>
        {block.text}
      </div>
    )
  }
  if (block.kind === 'file_change') {
    if (block.changes) return <FileChangesCard changes={block.changes} compact />
    return (
      <div style={{ borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', padding: '8px 10px', fontSize: 14, color: 'var(--text-2)' }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>文件修改</div>
        <div style={{ color: 'var(--text-3)' }}>{block.summary || '文件修改详情按需加载'}</div>
      </div>
    )
  }
  if (block.kind === 'plan') {
    return (
      <div style={{ borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', padding: '8px 10px', fontSize: 14, color: 'var(--text-2)' }}>
        {block.summary && <div style={{ color: 'var(--text-3)', marginBottom: block.plan.length ? 6 : 0 }}>{block.summary}</div>}
        {block.plan.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {block.plan.map((item, index) => (
              <div key={`${item.content}-${index}`} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ color: item.status === 'completed' ? 'var(--green)' : item.status === 'in_progress' ? 'var(--blue)' : 'var(--text-3)', flexShrink: 0 }}>
                  {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'}
                </span>
                <span style={{ minWidth: 0 }}>{item.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (block.kind === 'stage') {
    return <div style={{ fontSize: 14, color: 'var(--text-3)' }}>{block.text}</div>
  }
  return <ProcessNoteBlock text={block.text} />
}

function ProcessNoteBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const preview = compactText(text)
  return (
    <div style={{ borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          width: '100%',
          border: 'none',
          background: 'transparent',
          padding: '7px 9px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          color: 'var(--text-2)',
          fontSize: 14,
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span style={{ flexShrink: 0, fontWeight: 600 }}>中间说明</span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
          {preview}
        </span>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-2)', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto' }}>
          <MarkdownRenderer content={text} />
        </div>
      )}
    </div>
  )
}

function compactText(text: string): string {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length > 96 ? `${value.slice(0, 96)}…` : value
}

function ChatBubbleBlockView({
  block,
  isLast,
  isStreaming,
}: {
  block: ChatBubbleBlock
  isLast: boolean
  isStreaming: boolean
}) {
  let content = ''
  let thinking: string | null | undefined = null
  let attachments: ImageAttachmentInfo[] = []
  let toolCalls: ToolCallInfo[] = []

  if ('kind' in block) {
    if (block.kind === 'tool') {
      toolCalls = [block.toolCall]
    } else {
      content = block.content
      thinking = block.thinking
      attachments = block.attachments || []
    }
  } else {
    content = block.content
    thinking = block.thinking
    toolCalls = block.streaming ? (block.toolCalls || block.parsedToolCalls || parseJsonArray<ToolCallInfo>(block.tool_calls_json)) : []
    attachments = block.parsedAttachments || parseJsonArray<ImageAttachmentInfo>(block.attachments_json)
  }

  const defaultThinkingOpen = !!(isStreaming && thinking)
  const [thinkingOpenOverride, setThinkingOpenOverride] = useState<'open' | 'closed' | null>(null)
  const thinkingOpen = thinkingOpenOverride === 'open' || (thinkingOpenOverride !== 'closed' && defaultThinkingOpen)
  const toggleThinkingOpen = () =>
    setThinkingOpenOverride(thinkingOpen ? 'closed' : defaultThinkingOpen ? null : 'open')
  const hasBlock = !!content || !!thinking || attachments.length > 0 || toolCalls.length > 0
  if (!hasBlock) return null

  return (
    <div style={{ marginBottom: isLast ? 0 : 8 }}>
      {thinking && (
        <div style={{ marginBottom: 8, borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <button
            type="button"
            onClick={toggleThinkingOpen}
            style={{
              width: '100%',
              padding: '6px 10px',
              border: 'none',
              background: 'var(--bg-2)',
              color: 'var(--text-3)',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              textAlign: 'left',
            }}
          >
            {thinkingOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 思考过程
            {isStreaming && (
              <Loader2 size={10} style={{ animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />
            )}
          </button>
          {thinkingOpen && (
            <div
              style={{
                padding: '8px 10px',
                fontSize: 14,
                color: 'var(--text-2)',
                fontStyle: 'italic',
                lineHeight: 1.6,
                maxHeight: 200,
                overflow: 'auto',
                overflowWrap: 'anywhere',
              }}
            >
              {thinking}
            </div>
          )}
        </div>
      )}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {attachments.map((img, i) => (
            <img
              key={i}
              src={`data:${img.mimeType};base64,${img.data}`}
              alt={img.name || '附件'}
              style={{
                maxWidth: 180,
                maxHeight: 140,
                borderRadius: 8,
                border: '1px solid var(--border)',
                objectFit: 'cover',
              }}
            />
          ))}
        </div>
      )}
      {toolCalls.length > 0 && (
        <div style={{ marginBottom: content ? 8 : 0 }}>
          {toolCalls.map((tc) => (
            <ToolCallPanel key={tc.id} tc={tc} isStreaming={isStreaming} />
          ))}
        </div>
      )}
      {!isStreaming && toolCalls.length === 0 && !('kind' in block) && block.has_tool_calls && block.session_id && (
        <LazyToolCallsBlock
          sessionId={block.session_id}
          messageId={block.id}
          count={block.tool_call_count}
        />
      )}
      {content && <MarkdownRenderer content={content || ''} />}
    </div>
  )
}

/* ─── Dropdown Portal ─── */
function DropdownPortal({
  children,
  onClose,
  style,
}: {
  children: React.ReactNode
  onClose: () => void
  style: React.CSSProperties
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
      <div
        style={{
          position: 'fixed',
          minWidth: 220,
          maxHeight: 360,
          overflowY: 'auto',
          overflowX: 'hidden',
          background: 'var(--bg-0)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
          zIndex: 2001,
          padding: 6,
          boxSizing: 'border-box',
          transform: 'translateY(-100%)',
          ...style,
        }}
      >
        {children}
      </div>
    </>
  )
}

/* ─── New Task Modal ─── */
function NewTaskModal({
  agents,
  onCreate,
  onClose,
}: {
  agents: AgentData[]
  onCreate: (title: string, desc?: string, agentId?: string) => Promise<TaskData>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [agentId, setAgentId] = useState('')
  const [creating, setCreating] = useState(false)
  const handleCreate = async () => {
    if (!title.trim()) return
    setCreating(true)
    try {
      await onCreate(title, desc || undefined, agentId || undefined)
      onClose()
    } catch (e) {
      console.error('创建任务失败:', e)
    } finally {
      setCreating(false)
    }
  }
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 440,
          background: 'var(--bg-0)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 1001,
          padding: 24,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>新建任务</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>
              任务标题
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如: 实现用户登录功能"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: 15,
                background: 'var(--bg-1)',
                color: 'var(--text-1)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>
              描述
            </label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="详细描述需求..."
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: 15,
                background: 'var(--bg-1)',
                color: 'var(--text-1)',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>
              指派 Agent
            </label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: 15,
                background: 'var(--bg-1)',
                color: 'var(--text-1)',
                outline: 'none',
              }}
            >
              <option value="">不指派（放入待办）</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.runtime})
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleCreate}
              disabled={!title.trim() || creating}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--blue)',
                color: 'white',
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
                opacity: title.trim() ? 1 : 0.5,
              }}
            >
              {creating ? '创建中...' : '创建任务'}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-0)',
                color: 'var(--text-2)',
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
