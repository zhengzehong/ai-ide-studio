import {
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
  useMemo,
  type MouseEvent,
  type DragEvent,
  type ClipboardEvent,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  Clock,
  FolderOpen,
  GripVertical,
  Eye,
  EyeOff,
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
  type SessionData,
  type ToolCallInfo,
} from '../stores/session.store'
import type { TurnProcessBlock } from '../stores/turn-blocks'
import { useTaskStore, type SessionMode, type TaskData, type TaskEventData } from '../stores/task.store'
import { useConnectionStore } from '../stores/connection.store'
import { useProjectStore } from '../stores/project.store'
import { useModelStore, type ModelProfileData } from '../stores/model.store'
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
import { buildWorkspaceTaskCreateTarget } from './workspace/task-session-target'
import { TimelinePopover } from '../components/chat/TimelinePopover'
import { processBlockNeedsDetail } from '../components/chat/process-detail'
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
  sessionTitle,
  statusDot,
  statusLabel,
  toolSummary,
  type MenuAnchor,
  type MenuName,
} from './workspace/helpers'
import { createSessionDraftStore, type WorkspacePendingImage } from './workspace/session-drafts'
import { prepareNestedOrderDragEvent, moveItemById, sortWorkspaceItems } from './workspace/ordering'
import { sessionIndicator } from '../utils/session-indicators'
import { elapsedSecondsBetween, formatCompactDuration } from '../utils/duration'
import { ContextMenu, PromptDialog, ConfirmDialog, AlertDialog } from '../components/ModalDialog'
import { LocalSessionImportModal } from './workspace/LocalSessionImportModal'
import { TaskImageInput } from '../components/task/TaskImageInput'

const COPYING_STAGE = '正在复制会话...'

function canImportLocalSession(runtime: string): runtime is 'codex' | 'claude' {
  return runtime === 'codex' || runtime === 'claude'
}

export default function Workspace() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const connected = useConnectionStore((s) => s.connected)
  const agents = useAgentStore((s) => s.agents)
  const sessions = useSessionStore((s) => s.sessions)
  const runningSessionIds = useSessionStore((s) => s.runningSessionIds)
  const unreadSessionIds = useSessionStore((s) => s.unreadSessionIds)
  const copyingTargetSessionIds = useSessionStore((s) => s.copyingTargetSessionIds)
  const copyingSourceSessionIds = useSessionStore((s) => s.copyingSourceSessionIds)
  const lastCopyError = useSessionStore((s) => s.lastCopyError)
  const clearCopyError = useSessionStore((s) => s.clearCopyError)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const selectSession = useSessionStore((s) => s.selectSession)
  const createSession = useSessionStore((s) => s.createSession)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const fetchMessages = useSessionStore((s) => s.fetchMessages)
  const fetchEvents = useSessionStore((s) => s.fetchEvents)
  const renameSession = useSessionStore((s) => s.renameSession)
  const copySession = useSessionStore((s) => s.copySession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const closeSession = useSessionStore((s) => s.closeSession)
  const archiveSession = useSessionStore((s) => s.archiveSession)
  const reorderSessions = useSessionStore((s) => s.reorderSessions)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const deleteAgent = useAgentStore((s) => s.deleteAgent)
  const setAgentHidden = useAgentStore((s) => s.setAgentHidden)
  const reorderAgents = useAgentStore((s) => s.reorderAgents)
  const updateAgent = useAgentStore((s) => s.updateAgent)
  const modelProfiles = useModelStore((s) => s.profiles)
  const fetchModelProfiles = useModelStore((s) => s.fetchProfiles)
  const fetchTasks = useTaskStore((s) => s.fetchTasks)
  const tasks = useTaskStore((s) => s.tasks)
  const createTask = useTaskStore((s) => s.createTask)
  const modes = useTaskStore((s) => s.modes)
  const fetchModes = useTaskStore((s) => s.fetchModes)
  const teamContext = useTeamStore((s) => s.current)
  const fetchCurrentTeam = useTeamStore((s) => s.fetchCurrent)
  const clearCurrentTeam = useTeamStore((s) => s.clearCurrent)

  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const selectProject = useProjectStore((s) => s.selectProject)
  const fileTree = useFileSystemStore((s) => s.tree)
  const openFile = useFileSystemStore((s) => s.openFile)
  const fetchTree = useFileSystemStore((s) => s.fetchTree)
  const expandDir = useFileSystemStore((s) => s.expandDir)
  const openFileByPath = useFileSystemStore((s) => s.openFileByPath)
  const closeFile = useFileSystemStore((s) => s.closeFile)

  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'files'>('sessions')
  const [expandedAgents, setExpandedAgents] = useState<Set<string> | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [orderingMode, setOrderingMode] = useState(false)
  const [agentVisibilityOpen, setAgentVisibilityOpen] = useState(false)
  const [draggedOrderItem, setDraggedOrderItem] = useState<{ type: 'agent' | 'session'; id: string; agentId?: string } | null>(null)

  useEffect(() => {
    if (currentProjectId && sidebarTab === 'files') fetchTree(currentProjectId)
  }, [currentProjectId, sidebarTab, fetchTree])
  const [showNewTask, setShowNewTask] = useState(false)
  const [copyingSessionId, setCopyingSessionId] = useState<string | null>(null)

  const [ctxMenu, setCtxMenu] = useState<{ sessionId: string; agentId: string; x: number; y: number } | null>(null)
  const [agentCtxMenu, setAgentCtxMenu] = useState<{ agentId: string; x: number; y: number } | null>(null)
  const [modelProfileAgentId, setModelProfileAgentId] = useState<string | null>(null)
  const [importDialogAgentId, setImportDialogAgentId] = useState<string | null>(null)
  const [renameDialog, setRenameDialog] = useState<{ sessionId: string; currentTitle: string } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; danger?: boolean; onConfirm: () => void } | null>(null)
  const [alertMsg, setAlertMsg] = useState<string | null>(null)

  const projectAgents = useMemo(() => filterAgentsByProject(agents, currentProjectId), [agents, currentProjectId])
  const visibleProjectAgents = useMemo(() => projectAgents.filter((agent) => !agent.hidden_at), [projectAgents])
  const hiddenProjectAgents = useMemo(() => projectAgents.filter((agent) => !!agent.hidden_at), [projectAgents])
  const projectSessions = useMemo(
    () => filterSessionsByProject(sessions, currentProjectId),
    [sessions, currentProjectId],
  )
  const orderedProjectAgents = useMemo(() => sortWorkspaceItems(visibleProjectAgents), [visibleProjectAgents])
  const orderedAllProjectAgents = useMemo(() => sortWorkspaceItems(projectAgents), [projectAgents])
  const orderedProjectSessions = useMemo(() => sortWorkspaceItems(projectSessions), [projectSessions])
  const expandedAgentIds = useMemo(
    () => expandedAgents ?? new Set(orderedProjectAgents.map((a) => a.id)),
    [orderedProjectAgents, expandedAgents],
  )
  const chatAgent = useMemo(
    () => selectChatAgent({ agents: visibleProjectAgents, sessions: projectSessions, currentSessionId, selectedAgentId }),
    [currentSessionId, visibleProjectAgents, projectSessions, selectedAgentId],
  )
  const currentSession = useMemo(
    () => projectSessions.find((session) => session.id === currentSessionId),
    [currentSessionId, projectSessions],
  )
  const importDialogAgent = useMemo(
    () => projectAgents.find((agent) => agent.id === importDialogAgentId),
    [importDialogAgentId, projectAgents],
  )
  const agentContextAgent = useMemo(
    () => projectAgents.find((agent) => agent.id === agentCtxMenu?.agentId),
    [agentCtxMenu?.agentId, projectAgents],
  )
  const modelProfileAgent = useMemo(
    () => projectAgents.find((agent) => agent.id === modelProfileAgentId),
    [modelProfileAgentId, projectAgents],
  )
  const currentSessionCopying = !!currentSessionId && (
    !!copyingTargetSessionIds[currentSessionId] ||
    (!!currentSession && currentSession.stage === COPYING_STAGE && !currentSession.acp_session_id)
  )
  const agentSessions = useCallback((id: string) => orderedProjectSessions.filter((s) => s.agent_id === id), [orderedProjectSessions])

  const toggleAgent = (id: string) =>
    setExpandedAgents((p) => {
      const n = new Set(p ?? orderedProjectAgents.map((a) => a.id))
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const persistAgentOrder = useCallback(async (agentIds: string[]) => {
    if (!currentProjectId) return
    try {
      await reorderAgents(currentProjectId, agentIds)
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : 'Agent 排序保存失败')
    }
  }, [currentProjectId, reorderAgents])

  const persistSessionOrder = useCallback(async (agentId: string, sessionIds: string[]) => {
    if (!currentProjectId) return
    try {
      await reorderSessions(currentProjectId, agentId, sessionIds)
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : '会话排序保存失败')
    }
  }, [currentProjectId, reorderSessions])

  const dropAgentOn = useCallback((targetAgentId: string) => {
    if (draggedOrderItem?.type !== 'agent') return
    const ids = orderedProjectAgents.map((agent) => agent.id)
    const targetIndex = ids.indexOf(targetAgentId)
    const next = moveItemById(ids, draggedOrderItem.id, targetIndex)
    setDraggedOrderItem(null)
    if (next !== ids) void persistAgentOrder(next)
  }, [draggedOrderItem, orderedProjectAgents, persistAgentOrder])

  const dropSessionOn = useCallback((agentId: string, targetSessionId: string) => {
    if (draggedOrderItem?.type !== 'session' || draggedOrderItem.agentId !== agentId) return
    const ids = agentSessions(agentId).map((session) => session.id)
    const targetIndex = ids.indexOf(targetSessionId)
    const next = moveItemById(ids, draggedOrderItem.id, targetIndex)
    setDraggedOrderItem(null)
    if (next !== ids) void persistSessionOrder(agentId, next)
  }, [agentSessions, draggedOrderItem, persistSessionOrder])

  useEffect(() => {
    if (!currentSessionId) return
    const current = projectSessions.find((session) => session.id === currentSessionId)
    if (!currentProjectId || !current) selectSession(null)
  }, [currentProjectId, currentSessionId, projectSessions, selectSession])

  useEffect(() => {
    if (!currentSessionId) return
    const current = projectSessions.find((session) => session.id === currentSessionId)
    if (!current) return
    const currentAgent = projectAgents.find((agent) => agent.id === current.agent_id)
    if (currentAgent?.hidden_at) {
      queueMicrotask(() => {
        setSelectedAgentId(null)
        selectSession(null)
      })
    }
  }, [currentSessionId, projectAgents, projectSessions, selectSession])

  useEffect(() => {
    const targetProjectId = searchParams.get('projectId')
    if (targetProjectId && currentProjectId !== targetProjectId) {
      selectProject(targetProjectId)
      return
    }
    const targetSessionId = searchParams.get('sessionId')
    if (!targetSessionId) return
    const targetSession = projectSessions.find((session) => session.id === targetSessionId)
    if (!targetSession) return
    queueMicrotask(() => {
      setSelectedAgentId(targetSession.agent_id)
      selectSession(targetSession.id)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('sessionId')
        next.delete('projectId')
        return next
      }, { replace: true })
    })
  }, [currentProjectId, projectSessions, searchParams, selectProject, selectSession, setSearchParams])

  useEffect(() => {
    if (searchParams.get('sessionId')) return
    if (currentSessionId || projectSessions.length === 0) return
    const storedSessionId = readStoredSessionId()
    if (!storedSessionId) return
    const storedSession = projectSessions.find((session) => session.id === storedSessionId)
    if (!storedSession) return
    selectSession(storedSession.id)
  }, [currentSessionId, projectSessions, searchParams, selectSession])

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
  const handleRenameSession = (sessionId: string, currentTitle: string) => {
    setRenameDialog({ sessionId, currentTitle })
  }
  const handleRenameConfirm = async (nextTitle: string) => {
    if (!renameDialog) return
    await renameSession(renameDialog.sessionId, nextTitle)
    setRenameDialog(null)
  }
  const handleCopySession = async (agentId: string, sessionId: string) => {
    if (copyingSessionId) return
    setCopyingSessionId(sessionId)
    try {
      const copied = await copySession(sessionId)
      setSelectedAgentId(agentId)
      selectSession(copied.id)
      await fetchSessions(undefined, currentProjectId ?? undefined)
      await fetchMessages(copied.id)
      await fetchEvents(copied.id)
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : '复制会话失败')
    } finally {
      setCopyingSessionId((current) => (current === sessionId ? null : current))
    }
  }
  const handleLocalSessionImported = async (agentId: string, session: SessionData) => {
    setSelectedAgentId(agentId)
    selectSession(session.id)
    await fetchSessions(undefined, currentProjectId ?? undefined)
    await fetchMessages(session.id)
    await fetchEvents(session.id)
  }
  const handleDeleteSession = (sessionId: string) => {
    setConfirmDialog({
      title: '删除会话',
      message: '确定删除这个会话吗？历史记录会从列表隐藏。',
      danger: true,
      onConfirm: async () => {
        await deleteSession(sessionId)
        setConfirmDialog(null)
      },
    })
  }
  const handleCloseSession = async (sessionId: string) => {
    await closeSession(sessionId)
  }
  const handleArchiveSession = async (sessionId: string) => {
    await archiveSession(sessionId)
  }
  const handleHideAgent = async (agentId: string) => {
    try {
      await setAgentHidden(agentId, true)
      if (selectedAgentId === agentId) setSelectedAgentId(null)
      if (currentSession?.agent_id === agentId) {
        setSelectedAgentId(null)
        selectSession(null)
      }
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : '隐藏 Agent 失败')
    }
  }
  const handleShowAgent = async (agentId: string) => {
    try {
      await setAgentHidden(agentId, false)
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : '显示 Agent 失败')
    }
  }
  const handleDeleteAgent = (agent: AgentData) => {
    setConfirmDialog({
      title: '删除 Agent',
      message: `确定删除「${agent.name}」吗？该 Agent 会从项目中移除，已有会话和任务记录不会自动清理。`,
      danger: true,
      onConfirm: async () => {
        try {
          const deletingCurrentSession = currentSession?.agent_id === agent.id
          await deleteAgent(agent.id)
          if (selectedAgentId === agent.id) setSelectedAgentId(null)
          if (deletingCurrentSession) selectSession(null)
          setConfirmDialog(null)
          setAgentVisibilityOpen(false)
        } catch (err) {
          setConfirmDialog(null)
          setAlertMsg(err instanceof Error ? err.message : '删除 Agent 失败')
        }
      },
    })
  }

  useEffect(() => {
    if (!lastCopyError) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setAlertMsg(lastCopyError.message)
      clearCopyError()
    })
    return () => { cancelled = true }
  }, [clearCopyError, lastCopyError])

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
      void fetchModes(currentProjectId ?? undefined)
    })
    return () => { off() }
  }, [connected, currentProjectId, currentSessionId, teamContext.team?.id, fetchAgents, fetchSessions, fetchTasks, fetchModes])

  useEffect(() => {
    if (!currentSessionId || !connected) {
      clearCurrentTeam()
      return
    }
    void fetchCurrentTeam(currentSessionId)
  }, [currentSessionId, connected, fetchCurrentTeam, clearCurrentTeam])
  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-1)' }}>
      {/* ─── Left Sidebar ─── */}
      <aside
        style={{
          width: 220,
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
            <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                {connected ? <Wifi size={12} color="var(--green)" /> : <WifiOff size={12} color="var(--red)" />}
                <span style={{ fontSize: 13, color: connected ? 'var(--green)' : 'var(--red)' }}>
                  {connected ? '已连接' : '未连接'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAgentVisibilityOpen((value) => !value)}
                title="显示/隐藏 Agent"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 24,
                  border: agentVisibilityOpen ? '1px solid rgba(37, 99, 235, 0.28)' : '1px solid transparent',
                  background: agentVisibilityOpen ? 'var(--blue-light)' : 'transparent',
                  color: agentVisibilityOpen ? 'var(--blue)' : 'var(--text-3)',
                  borderRadius: 6,
                  padding: '0 7px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {hiddenProjectAgents.length > 0 ? <EyeOff size={12} /> : <Eye size={12} />}
                显示
              </button>
              <button
                type="button"
                onClick={() => setOrderingMode((value) => !value)}
                title={orderingMode ? '完成排序' : '自定义排序'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 24,
                  border: orderingMode ? '1px solid rgba(37, 99, 235, 0.28)' : '1px solid transparent',
                  background: orderingMode ? 'var(--blue-light)' : 'transparent',
                  color: orderingMode ? 'var(--blue)' : 'var(--text-3)',
                  borderRadius: 6,
                  padding: '0 7px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <GripVertical size={12} /> {orderingMode ? '完成' : '排序'}
              </button>
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
              {projectAgents.length > 0 && orderedProjectAgents.length === 0 && (
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
                  <EyeOff size={24} color="var(--text-3)" style={{ marginBottom: 8, opacity: 0.5 }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', marginBottom: 5 }}>
                    Agent 已全部隐藏
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 10 }}>
                    当前项目有 {hiddenProjectAgents.length} 个隐藏 Agent。
                  </div>
                  <button
                    type="button"
                    onClick={() => setAgentVisibilityOpen(true)}
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
                    管理显示
                  </button>
                </div>
              )}
              {orderedProjectAgents.map((agent) => (
                <div
                  key={agent.id}
                  onDragOver={(e) => orderingMode && e.preventDefault()}
                  onDrop={(e) => {
                    if (!orderingMode) return
                    e.preventDefault()
                    dropAgentOn(agent.id)
                  }}
                  onDragEnd={() => setDraggedOrderItem(null)}
                  style={{
                    marginBottom: 2,
                    display: 'grid',
                    gridTemplateColumns: '1fr',
                    alignItems: 'center',
                    opacity: draggedOrderItem?.type === 'agent' && draggedOrderItem.id === agent.id ? 0.55 : 1,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!orderingMode) toggleAgent(agent.id)
                    }}
                    onContextMenu={(e) => {
                      if (orderingMode) return
                      e.preventDefault()
                      e.stopPropagation()
                      setCtxMenu(null)
                      setAgentCtxMenu({ agentId: agent.id, x: e.clientX, y: e.clientY })
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flex: 1,
                      minWidth: 0,
                      padding: '7px 14px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-1)',
                      cursor: orderingMode ? 'default' : 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {orderingMode && (
                      <span
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation()
                          setDraggedOrderItem({ type: 'agent', id: agent.id })
                        }}
                        onDragEnd={(e) => {
                          e.stopPropagation()
                          setDraggedOrderItem(null)
                        }}
                        style={orderGripStyle}
                        title="拖拽排序"
                      >
                        <GripVertical size={14} />
                      </span>
                    )}
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
                    <div style={{ gridColumn: '1 / -1' }}>
                      {agentSessions(agent.id).map((s) => {
                        const indicator = sessionIndicator(s, runningSessionIds, unreadSessionIds)
                        return (
                          <div
                            key={s.id}
                            onDragOver={(e) => {
                              if (!orderingMode) return
                              prepareNestedOrderDragEvent(e)
                            }}
                            onDrop={(e) => {
                              if (!orderingMode) return
                              prepareNestedOrderDragEvent(e)
                              dropSessionOn(agent.id, s.id)
                            }}
                            onContextMenu={(e) => {
                              if (orderingMode) return
                              e.preventDefault()
                              setAgentCtxMenu(null)
                              setCtxMenu({ sessionId: s.id, agentId: agent.id, x: e.clientX, y: e.clientY })
                            }}
                            style={{
                              position: 'relative',
                              display: 'flex',
                              alignItems: 'center',
                              paddingLeft: 42,
                              paddingRight: 8,
                              background: currentSessionId === s.id ? 'var(--blue-light)' : 'transparent',
                              borderRadius: 4,
                              opacity: draggedOrderItem?.type === 'session' && draggedOrderItem.id === s.id ? 0.55 : 1,
                            }}
                          >
                          <button
                            type="button"
                            onClick={() => {
                              if (!orderingMode) handleSelectSession(agent.id, s.id)
                            }}
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
                              cursor: orderingMode ? 'default' : 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            {orderingMode && (
                              <span
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation()
                                  setDraggedOrderItem({ type: 'session', id: s.id, agentId: agent.id })
                                }}
                                onDragEnd={(e) => {
                                  e.stopPropagation()
                                  setDraggedOrderItem(null)
                                }}
                                style={orderGripStyle}
                                title="拖拽排序"
                              >
                                <GripVertical size={13} />
                              </span>
                            )}
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
                    </div>
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
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <WorkspaceChatPane
            connected={connected}
            currentSessionId={currentSessionId}
            chatAgent={chatAgent}
            currentSessionTitle={currentSessionId ? sessionTitle(currentSession ?? { id: currentSessionId }) : undefined}
            currentSessionCopying={currentSessionCopying}
          />
        </div>
      </main>

      {/* Right Sidebar: session context */}
      <aside
        style={{
          width: 420,
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
            <TaskPanel
              tasks={tasks}
              agents={projectAgents}
              modes={modes}
              currentSessionTaskId={currentSession?.task_id ?? null}
              onSelectSession={handleSelectSession}
              projectId={currentProjectId ?? undefined}
            />
          </>
        )}
      </aside>

      {showNewTask && (
        <NewTaskModal
          agents={projectAgents}
          projectId={currentProjectId}
          onCreate={(title, desc, agentId, sessionId, sessionMode, images) => createTask(title, desc, agentId, currentProjectId ?? undefined, sessionId, sessionMode, images)}
          onClose={() => setShowNewTask(false)}
        />
      )}

      {importDialogAgent && (
        <LocalSessionImportModal
          agent={importDialogAgent}
          projectId={currentProjectId ?? undefined}
          onImported={(session) => handleLocalSessionImported(importDialogAgent.id, session)}
          onClose={() => setImportDialogAgentId(null)}
        />
      )}

      <ContextMenu
        open={!!agentCtxMenu}
        x={agentCtxMenu?.x ?? 0}
        y={agentCtxMenu?.y ?? 0}
        onClose={() => setAgentCtxMenu(null)}
        items={agentCtxMenu && agentContextAgent ? [
          {
            label: canImportLocalSession(agentContextAgent.runtime) ? '导入本地会话' : '导入本地会话（仅 Codex/Claude）',
            disabled: !canImportLocalSession(agentContextAgent.runtime),
            onClick: () => setImportDialogAgentId(agentContextAgent.id),
          },
          {
            label: '模型档案',
            disabled: agentContextAgent.runtime !== 'claude' && agentContextAgent.runtime !== 'codex',
            onClick: () => setModelProfileAgentId(agentContextAgent.id),
          },
          {
            label: '隐藏 Agent',
            onClick: () => { void handleHideAgent(agentContextAgent.id) },
          },
          {
            label: '删除 Agent',
            danger: true,
            onClick: () => handleDeleteAgent(agentContextAgent),
          },
        ] : []}
      />

      {modelProfileAgent && (
        <AgentModelProfileDialog
          key={modelProfileAgent.id}
          agent={modelProfileAgent}
          profiles={modelProfiles}
          onLoadProfiles={() => fetchModelProfiles()}
          onSave={async (modelProfileId) => {
            await updateAgent(modelProfileAgent.id, { modelProfileId })
            setModelProfileAgentId(null)
          }}
          onClose={() => setModelProfileAgentId(null)}
        />
      )}

      <ContextMenu
        open={!!ctxMenu}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        onClose={() => setCtxMenu(null)}
        items={ctxMenu ? [
          { label: '重命名', onClick: () => { const s = projectSessions.find(ss => ss.id === ctxMenu.sessionId); handleRenameSession(ctxMenu.sessionId, sessionTitle(s ?? { id: ctxMenu.sessionId })) } },
          { label: '关闭', onClick: () => handleCloseSession(ctxMenu.sessionId) },
          {
            label: copyingSessionId === ctxMenu.sessionId || copyingSourceSessionIds[ctxMenu.sessionId] ? '复制中...' : '复制',
            disabled: copyingSessionId === ctxMenu.sessionId || !!copyingSourceSessionIds[ctxMenu.sessionId],
            onClick: () => handleCopySession(ctxMenu.agentId, ctxMenu.sessionId),
          },
          { label: '归档', onClick: () => handleArchiveSession(ctxMenu.sessionId) },
          { label: '删除', danger: true, onClick: () => handleDeleteSession(ctxMenu.sessionId) },
        ] : []}
      />

      {agentVisibilityOpen && (
        <div
          style={{
            position: 'fixed',
            left: 252,
            top: 108,
            zIndex: 9998,
            width: 300,
            maxWidth: 'calc(100vw - 24px)',
            background: 'var(--bg-0)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 12px 28px rgba(15,23,42,0.14), 0 3px 8px rgba(15,23,42,0.08)',
            padding: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>显示/隐藏 Agent</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                {visibleProjectAgents.length} 个显示，{hiddenProjectAgents.length} 个隐藏
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAgentVisibilityOpen(false)}
              style={{
                width: 24,
                height: 24,
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--text-3)',
                cursor: 'pointer',
              }}
              title="关闭"
            >
              <X size={15} />
            </button>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {orderedAllProjectAgents.map((agent) => {
              const hidden = !!agent.hidden_at
              return (
                <div
                  key={agent.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 6px',
                    borderRadius: 7,
                    background: hidden ? 'var(--bg-1)' : 'transparent',
                    opacity: hidden ? 0.72 : 1,
                  }}
                >
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agent.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{hidden ? '已隐藏' : '显示中'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void (hidden ? handleShowAgent(agent.id) : handleHideAgent(agent.id)) }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      height: 26,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-0)',
                      color: hidden ? 'var(--blue)' : 'var(--text-2)',
                      borderRadius: 6,
                      padding: '0 8px',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {hidden ? <Eye size={12} /> : <EyeOff size={12} />}
                    {hidden ? '显示' : '隐藏'}
                  </button>
                </div>
              )
            })}
            {orderedAllProjectAgents.length === 0 && (
              <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 14, textAlign: 'center' }}>当前项目暂无 Agent</div>
            )}
          </div>
        </div>
      )}

      <PromptDialog
        open={!!renameDialog}
        title="重命名会话"
        defaultValue={renameDialog?.currentTitle ?? ''}
        placeholder="输入新的会话名称"
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameDialog(null)}
      />

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        danger={confirmDialog?.danger}
        onConfirm={() => confirmDialog?.onConfirm()}
        onCancel={() => setConfirmDialog(null)}
      />

      <AlertDialog
        open={!!alertMsg}
        title="提示"
        message={alertMsg ?? ''}
        onClose={() => setAlertMsg(null)}
      />

    </div>
  )
}

function WorkspaceChatPane({
  connected,
  currentSessionId,
  chatAgent,
  currentSessionTitle,
  currentSessionCopying,
}: {
  connected: boolean
  currentSessionId: string | null
  chatAgent: AgentData | undefined
  currentSessionTitle?: string
  currentSessionCopying: boolean
}) {
  const messages = useSessionStore((s) => s.messages)
  const events = useSessionStore((s) => s.events)
  const streamingMessage = useSessionStore((s) => s.streamingMessage)
  const usage = useSessionStore((s) => s.usage)
  const capabilities = useSessionStore((s) => s.capabilities)
  const plan = useSessionStore((s) => s.plan)
  const sendPrompt = useSessionStore((s) => s.sendPrompt)
  const hasMoreMessagesBySession = useSessionStore((s) => s.hasMoreMessagesBySession)
  const loadingOlderMessagesBySession = useSessionStore((s) => s.loadingOlderMessagesBySession)
  const loadOlderMessages = useSessionStore((s) => s.loadOlderMessages)
  const setModel = useSessionStore((s) => s.setModel)
  const setMode = useSessionStore((s) => s.setMode)
  const setConfig = useSessionStore((s) => s.setConfig)
  const cancelTurn = useSessionStore((s) => s.cancelTurn)
  const pendingPermissions = useSessionStore((s) => s.pendingPermissions)
  const pendingElicitations = useSessionStore((s) => s.pendingElicitations)
  const respondPermission = useSessionStore((s) => s.respondPermission)
  const respondElicitation = useSessionStore((s) => s.respondElicitation)
  const fetchMessageProcess = useSessionStore((s) => s.fetchMessageProcess)
  const fetchMessageFileChanges = useSessionStore((s) => s.fetchMessageFileChanges)
  const fetchProcessItemDetail = useSessionStore((s) => s.fetchProcessItemDetail)
  const fileChangeDetailsByMessageId = useSessionStore((s) => s.fileChangeDetailsByMessageId)
  const turnProcessLoadingByMessageId = useSessionStore((s) => s.turnProcessLoadingByMessageId)
  const turnProcessErrorByMessageId = useSessionStore((s) => s.turnProcessErrorByMessageId)
  const toolCallLoadingByKey = useSessionStore((s) => s.toolCallLoadingByKey)
  const toolCallErrorByKey = useSessionStore((s) => s.toolCallErrorByKey)
  const processItemLoadingByKey = useSessionStore((s) => s.processItemLoadingByKey)
  const processItemErrorByKey = useSessionStore((s) => s.processItemErrorByKey)

  const [inputValue, setInputValue] = useState('')
  const [pendingImages, setPendingImages] = useState<WorkspacePendingImage[]>([])
  const [draggingImages, setDraggingImages] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showConfigMenu, setShowConfigMenu] = useState<string | null>(null)
  const [showCommandMenu, setShowCommandMenu] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now())

  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const prevMsgCount = useRef(0)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stickToBottomRef = useRef(true)
  const lastScrollHeightRef = useRef(0)
  const olderLoadAnchorRef = useRef<{ sessionId: string; scrollHeight: number; scrollTop: number } | null>(null)
  const inputValueRef = useRef('')
  const pendingImagesRef = useRef<WorkspacePendingImage[]>([])
  const draftSessionIdRef = useRef<string | null>(currentSessionId)
  const sessionDraftsRef = useRef(createSessionDraftStore({ revokePreview: (preview) => URL.revokeObjectURL(preview) }))

  const blockingInteraction = pendingPermissions.length > 0 || pendingElicitations.length > 0
  const canSendPrompt = !!currentSessionId && connected && !blockingInteraction && !currentSessionCopying && (!!inputValue.trim() || pendingImages.length > 0)
  const hasMoreMessages = currentSessionId ? hasMoreMessagesBySession[currentSessionId] === true : false
  const loadingOlderMessages = currentSessionId ? !!loadingOlderMessagesBySession[currentSessionId] : false
  const pendingInteractionId = pendingPermissions[0]?.id || pendingElicitations[0]?.id || ''
  const isStreaming = !!(streamingMessage && !streamingMessage.done)
  const currentModeName =
    capabilities.modes.find((m) => m.modeId === capabilities.currentModeId)?.name || capabilities.currentModeId
  const currentModelName =
    capabilities.models.find((m) => m.modelId === capabilities.currentModelId)?.name || capabilities.currentModelId
  const secondaryConfigs = capabilities.configOptions.filter(
    (o) => o.category !== 'model' && o.category !== 'mode' && o.id !== 'model' && o.id !== 'mode',
  )

  const updateInputValue = useCallback((value: string) => {
    inputValueRef.current = value
    setInputValue(value)
  }, [])

  const updatePendingImages = useCallback((updater: (current: WorkspacePendingImage[]) => WorkspacePendingImage[]) => {
    const next = updater(pendingImagesRef.current)
    pendingImagesRef.current = next
    setPendingImages(next)
  }, [])

  const resetTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [])

  const saveActiveDraft = useCallback(() => {
    sessionDraftsRef.current.save(draftSessionIdRef.current, {
      text: inputValueRef.current,
      images: pendingImagesRef.current,
    })
  }, [])

  const restoreDraft = useCallback((sessionId: string | null) => {
    const draft = sessionDraftsRef.current.take(sessionId)
    draftSessionIdRef.current = sessionId
    inputValueRef.current = draft.text
    pendingImagesRef.current = draft.images
    setInputValue(draft.text)
    setPendingImages(draft.images)
    requestAnimationFrame(resetTextareaHeight)
  }, [resetTextareaHeight])

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
    if (currentSessionId && el.scrollTop <= 120 && hasMoreMessages && !loadingOlderMessages) {
      olderLoadAnchorRef.current = {
        sessionId: currentSessionId,
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      }
      void loadOlderMessages(currentSessionId)
    }
    stickToBottomRef.current = nextPinnedToBottom({
      wasPinned: stickToBottomRef.current,
      previousScrollHeight: lastScrollHeightRef.current,
      metrics: el,
    })
    lastScrollHeightRef.current = el.scrollHeight
  }, [currentSessionId, hasMoreMessages, loadOlderMessages, loadingOlderMessages])

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

  useLayoutEffect(() => {
    if (draftSessionIdRef.current === currentSessionId) return
    saveActiveDraft()
    restoreDraft(currentSessionId)
  }, [currentSessionId, restoreDraft, saveActiveDraft])

  useEffect(() => () => {
    saveActiveDraft()
    sessionDraftsRef.current.dispose()
  }, [saveActiveDraft])

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
    const olderLoadAnchor = olderLoadAnchorRef.current
    if (olderLoadAnchor && olderLoadAnchor.sessionId === currentSessionId) {
      const el = chatScrollRef.current
      if (el) {
        const delta = el.scrollHeight - olderLoadAnchor.scrollHeight
        el.scrollTop = olderLoadAnchor.scrollTop + delta
        lastScrollHeightRef.current = el.scrollHeight
      }
      olderLoadAnchorRef.current = null
      return
    }
    if (messages.length !== prevMsgCount.current) {
      prevMsgCount.current = messages.length
      const el = chatScrollRef.current
      if (!el || stickToBottomRef.current || isNearBottom(el)) scheduleScrollToBottom('smooth')
    }
  }, [currentSessionId, messages.length, scheduleScrollToBottom])

  useEffect(() => {
    if (shouldScrollStreaming && stickToBottomRef.current) scheduleScrollToBottom('auto')
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    }
  }, [shouldScrollStreaming, streamingScrollSignature, scheduleScrollToBottom])

  useEffect(() => {
    if (!isStreaming) return undefined
    const timer = window.setInterval(() => setLiveNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isStreaming])

  useEffect(() => {
    if (blockingInteraction) requestAnimationFrame(() => scrollToBottom('smooth'))
  }, [blockingInteraction, pendingInteractionId, scrollToBottom])

  const autoResize = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  }

  const clearPendingImages = () => {
    updatePendingImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.preview))
      return []
    })
  }

  const handleSend = () => {
    const v = inputValue.trim()
    const hasImages = pendingImages.length > 0
    if ((!v && !hasImages) || !currentSessionId || !connected || blockingInteraction || currentSessionCopying) return
    stickToBottomRef.current = true
    sendPrompt(
      v,
      hasImages ? pendingImages.map((i) => ({ data: i.data, mimeType: i.mimeType })) : undefined,
    )
    sessionDraftsRef.current.clear(currentSessionId)
    updateInputValue('')
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

  const addImageFiles = (files: File[]) => {
    const targetSessionId = currentSessionId
    if (!targetSessionId) return
    files.filter((file) => file.type.startsWith('image/')).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const image = { data: (reader.result as string).split(',')[1], mimeType: file.type, preview: URL.createObjectURL(file) }
        if (draftSessionIdRef.current === targetSessionId) {
          updatePendingImages((prev) => [...prev, image])
          return
        }
        const draft = sessionDraftsRef.current.take(targetSessionId)
        sessionDraftsRef.current.save(targetSessionId, { ...draft, images: [...draft.images, image] })
      }
      reader.readAsDataURL(file)
    })
  }

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) addImageFiles(Array.from(files))
    e.target.value = ''
  }

  const removePendingImage = (index: number) => {
    updatePendingImages((prev) => {
      const removed = prev[index]
      if (removed) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== index)
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
      if (item.kind === 'group') return <MemoChatBubble group={item.group} agent={chatAgent} isStreaming={false} />
      if (item.kind === 'streaming') {
        return <MemoChatBubble message={item.message} agent={chatAgent} isStreaming footer={interactionPanel} liveElapsedSeconds={liveElapsedSeconds} />
      }
      if (item.kind === 'blocking') return <BlockingInteractionBar agent={chatAgent} panel={interactionPanel} />
      return (
        <MemoChatBubble
          message={item.message}
          agent={chatAgent}
          isStreaming={false}
          onLoadMessageProcess={fetchMessageProcess}
          onLoadMessageFileChanges={fetchMessageFileChanges}
          onLoadProcessItemDetail={fetchProcessItemDetail}
          fileChangeDetailsByMessageId={fileChangeDetailsByMessageId}
          fileChangeLoadingByKey={toolCallLoadingByKey}
          fileChangeErrorByKey={toolCallErrorByKey}
          processItemLoadingByKey={processItemLoadingByKey}
          processItemErrorByKey={processItemErrorByKey}
          turnProcessLoadingByMessageId={turnProcessLoadingByMessageId}
          turnProcessErrorByMessageId={turnProcessErrorByMessageId}
        />
      )
    },
    [chatAgent, fetchMessageFileChanges, fetchMessageProcess, fetchProcessItemDetail, fileChangeDetailsByMessageId, interactionPanel, liveElapsedSeconds, processItemErrorByKey, processItemLoadingByKey, toolCallErrorByKey, toolCallLoadingByKey, turnProcessErrorByMessageId, turnProcessLoadingByMessageId],
  )

  return (
    <>
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
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 15 }}>
                  <span>{chatAgent.name}</span>
                  {currentSessionTitle && (
                    <>
                      <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>·</span>
                      <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentSessionTitle}</span>
                    </>
                  )}
                </div>
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
      <div style={{ padding: '0 20px 16px', flexShrink: 0 }}>
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
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              updateInputValue(e.target.value)
              autoResize()
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              currentSessionCopying ? '正在复制会话，完成后可继续输入...' : blockingInteraction ? '等待你确认后继续...' : currentSessionId ? '输入消息...' : '先选择一个 Session'
            }
            disabled={!currentSessionId || !connected || blockingInteraction || currentSessionCopying}
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
              disabled={!currentSessionId || currentSessionCopying}
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
              <button type="button" onClick={(e) => openMenu('command', e)} style={toolbarButtonStyle}>
                <Wrench size={12} /> 命令 <ChevronDown size={10} />
              </button>
            )}
            {capabilities.modes.length > 0 && (
              <button type="button" onClick={(e) => openMenu('mode', e)} style={toolbarButtonStyle}>
                <Settings2 size={12} /> {modeCn(currentModeName)} <ChevronDown size={10} />
              </button>
            )}
            <div style={{ flex: 1 }} />
            {secondaryConfigs.map((opt) => (
              <button key={opt.id} type="button" onClick={(e) => openMenu(`config:${opt.id}`, e)} style={toolbarButtonStyle}>
                {configLabel(opt)} <ChevronDown size={10} />
              </button>
            ))}
            {usage && <MiniContextCircle used={usage.contextUsed} total={usage.contextSize} />}
            {capabilities.models.length > 0 && (
              <button
                type="button"
                onClick={(e) => openMenu('model', e)}
                style={{ ...toolbarButtonStyle, background: 'transparent' }}
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
      {showCommandMenu && (
        <DropdownPortal onClose={() => setShowCommandMenu(false)} style={menuStyle(menuAnchor, 320)}>
          {capabilities.commands.map((cmd) => (
            <button
              key={cmd.name}
              type="button"
              onClick={() => {
                updateInputValue(`/${cmd.name} `)
                setShowCommandMenu(false)
                textareaRef.current?.focus()
              }}
              style={commandMenuItemStyle}
            >
              <span style={{ fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                /{cmd.name}
              </span>
              <span style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.4 }}>
                {cmd.description || cmd.input?.hint || '插入命令'}
              </span>
            </button>
          ))}
        </DropdownPortal>
      )}
      {showModeMenu && (
        <DropdownPortal onClose={() => setShowModeMenu(false)} style={menuStyle(menuAnchor, 260)}>
          {capabilities.modes.map((m) => {
            const active = m.modeId === capabilities.currentModeId
            return (
              <MenuOption
                key={m.modeId}
                active={active}
                label={modeCn(m.name)}
                labelWeight={500}
                description={m.description}
                onClick={() => {
                  void setMode(m.modeId)
                  setShowModeMenu(false)
                }}
              />
            )
          })}
        </DropdownPortal>
      )}
      {showConfigMenu && (
        <DropdownPortal onClose={() => setShowConfigMenu(null)} style={menuStyle(menuAnchor, 240)}>
          {renderConfigMenu({
            configId: showConfigMenu,
            options: secondaryConfigs,
            setConfig,
            onClose: () => setShowConfigMenu(null),
          })}
        </DropdownPortal>
      )}
      {showModelMenu && (
        <DropdownPortal onClose={() => setShowModelMenu(false)} style={menuStyle(menuAnchor, 280)}>
          {capabilities.models.map((m) => (
            <MenuOption
              key={m.modelId}
              active={m.modelId === capabilities.currentModelId}
              label={m.name || m.modelId}
              fontSize={15}
              labelWeight={m.modelId === capabilities.currentModelId ? 600 : 400}
              onClick={() => {
                void setModel(m.modelId)
                setShowModelMenu(false)
              }}
            />
          ))}
        </DropdownPortal>
      )}
    </>
  )
}

const toolbarButtonStyle: React.CSSProperties = {
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
}

const orderGripStyle: React.CSSProperties = {
  width: 16,
  height: 20,
  borderRadius: 4,
  color: 'var(--text-3)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'grab',
  flexShrink: 0,
  opacity: 0.72,
}

const commandMenuItemStyle: React.CSSProperties = {
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
}

function MenuOption({
  active,
  label,
  fontSize = 14,
  labelWeight = active ? 600 : 500,
  description,
  onClick,
}: {
  active: boolean
  label: string
  fontSize?: number
  labelWeight?: React.CSSProperties['fontWeight']
  description?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        fontSize,
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
        <div style={{ fontWeight: labelWeight }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{description}</div>}
      </div>
    </button>
  )
}

function renderConfigMenu({
  configId,
  options,
  setConfig,
  onClose,
}: {
  configId: string
  options: PlanConfigOption[]
  setConfig: (configId: string, value: string | boolean) => Promise<void>
  onClose: () => void
}) {
  const opt = options.find((o) => o.id === configId)
  if (!opt) return null
  if (opt.type === 'boolean') {
    const active = opt.currentValue === true
    return (
      <MenuOption
        active={active}
        label={opt.name}
        labelWeight={400}
        onClick={() => {
          void setConfig(opt.id, !active)
          onClose()
        }}
      />
    )
  }
  return opt.options?.map((item) => (
    <MenuOption
      key={item.value}
      active={item.value === opt.currentValue}
      label={configOptionLabel(item.value, item.name)}
      labelWeight={500}
      description={item.description}
      onClick={() => {
        void setConfig(opt.id, item.value)
        onClose()
      }}
    />
  ))
}

type PlanConfigOption = {
  id: string
  name: string
  type: string
  currentValue?: string | boolean
  options?: { value: string; name: string; description?: string }[]
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
  { key: 'needs_attention', label: '需处理', icon: Zap, filter: (t) => t.status === 'needs_input' },
  { key: 'done', label: '已完成', icon: CheckCircle2, filter: (t) => ['completed', 'cancelled'].includes(t.status) },
]

function taskStageLabel(s: string): string {
  return (
    {
      executing: '执行中',
      needs_input: '待确认',
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
      needs_input: '#f59e0b',
      completed: 'var(--green)',
      backlog: 'var(--text-3)',
    }[s] ?? 'var(--text-3)'
  )
}

function TaskPanel({
  tasks,
  agents,
  modes,
  currentSessionTaskId,
  onSelectSession,
  projectId,
}: {
  tasks: TaskData[]
  agents: AgentData[]
  modes: Array<{ id: string; name: string }>
  currentSessionTaskId: string | null
  onSelectSession: (agentId: string, sessionId: string) => void
  projectId?: string
}) {
  const [tab, setTab] = useState('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const filtered = tasks.filter(TASK_TABS.find((t) => t.key === tab)!.filter)
  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const sessions = useSessionStore((s) => s.sessions)
  const selectSession = useSessionStore((s) => s.selectSession)

  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null
  const sessionsForTask = useMemo(() => {
    if (!selectedTask) return []
    return sessions.filter((s) => {
      if (s.task_id !== selectedTask.id) return false
      if (projectId && s.project_id !== projectId) return false
      return true
    })
  }, [selectedTask, sessions, projectId])

  const handleJumpToSession = (sessionId: string, agentId: string) => {
    selectSession(sessionId)
    onSelectSession(agentId, sessionId)
    setSelectedTaskId(null)
  }

  if (selectedTask) {
    return (
      <TaskDetailInline
        task={selectedTask}
        agents={agents}
        modes={modes}
        sessions={sessionsForTask}
        onBack={() => setSelectedTaskId(null)}
        onJumpToSession={handleJumpToSession}
      />
    )
  }

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
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 12px 12px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--text-3)' }}>
            <Archive size={28} style={{ opacity: 0.2, marginBottom: 8 }} />
            <div style={{ fontSize: 14 }}>暂无{TASK_TABS.find((t) => t.key === tab)?.label}任务</div>
          </div>
        ) : (
          filtered.map((task) => {
            const ag = task.assigned_agent_id ? agentMap.get(task.assigned_agent_id) : null
            const isCurrent = task.id === currentSessionTaskId
            const reportBadge = task.agent_report_status
              ? AGENT_REPORT_STATUS_BADGE[task.agent_report_status] ?? null
              : null
            return (
              <div
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                style={{
                  padding: isCurrent ? '10px 12px 10px 10px' : '10px 12px',
                  borderRadius: 8,
                  border: isCurrent ? '1px solid var(--blue)' : '1px solid var(--border)',
                  borderLeft: isCurrent ? '3px solid var(--blue)' : '1px solid var(--border)',
                  background: isCurrent ? 'var(--blue-light)' : 'var(--bg-1)',
                  marginBottom: 6,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div
                  style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, lineHeight: 1.4, color: 'var(--text-1)' }}
                >
                  {task.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'white',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: taskStageColor(task.status),
                    }}
                  >
                    {task.stage || taskStageLabel(task.status)}
                  </span>
                  {reportBadge && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 8,
                        background: reportBadge.bg,
                        color: reportBadge.color,
                        fontWeight: 500,
                      }}
                    >
                      {reportBadge.label}
                    </span>
                  )}
                  {ag && (
                    <span
                      style={{
                        fontSize: 11,
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
                  {isCurrent && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 8,
                        background: 'var(--blue)',
                        color: 'white',
                        fontWeight: 600,
                      }}
                    >
                      当前
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>
                    {formatTime(task.created_at)}
                  </span>
                </div>
                {task.description && (
                  <div
                    style={{
                      fontSize: 12,
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

const AGENT_REPORT_STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  in_progress: { label: '进行中', color: 'var(--blue)', bg: 'var(--blue-light)' },
  milestone: { label: '里程碑', color: '#7c3aed', bg: '#ede9fe' },
  blocked: { label: '卡住', color: 'var(--red)', bg: '#fee2e2' },
  done: { label: '已完成', color: 'var(--green)', bg: 'var(--green-light)' },
}

const TASK_EVENT_TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  created: { label: '创建', color: 'var(--text-3)', bg: 'var(--bg-2)' },
  assigned: { label: '分派', color: '#7c3aed', bg: '#ede9fe' },
  assigned_agent: { label: '分派', color: '#7c3aed', bg: '#ede9fe' },
  self_claimed: { label: '自认领', color: 'var(--blue)', bg: 'var(--blue-light)' },
  progress: { label: '进度', color: 'var(--text-2)', bg: 'var(--bg-2)' },
  milestone: { label: '里程碑', color: '#7c3aed', bg: '#ede9fe' },
  input_requested: { label: '请求确认', color: 'var(--red)', bg: '#fee2e2' },
  marked_done: { label: '本轮完成', color: 'var(--green)', bg: 'var(--green-light)' },
  replied: { label: '人工回复', color: 'var(--blue)', bg: 'var(--blue-light)' },
  status_changed: { label: '状态变更', color: 'var(--text-2)', bg: 'var(--bg-2)' },
  manual_status_change: { label: '手动改状态', color: 'var(--text-2)', bg: 'var(--bg-2)' },
  agent_status_changed: { label: 'Agent状态', color: 'var(--text-2)', bg: 'var(--bg-2)' },
  session_linked: { label: '关联会话', color: 'var(--text-2)', bg: 'var(--bg-2)' },
  updated: { label: '更新', color: 'var(--text-2)', bg: 'var(--bg-2)' },
}

function parseEventPayload(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown> } catch { return {} }
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    return `${days}天前`
  } catch { return iso }
}

function TaskDetailInline({
  task,
  agents,
  modes,
  sessions,
  onBack,
  onJumpToSession,
}: {
  task: TaskData
  agents: AgentData[]
  modes: Array<{ id: string; name: string }>
  sessions: SessionData[]
  onBack: () => void
  onJumpToSession: (sessionId: string, agentId: string) => void
}) {
  const fetchTaskEvents = useTaskStore((s) => s.fetchTaskEvents)
  const replyTask = useTaskStore((s) => s.replyTask)
  const updateTask = useTaskStore((s) => s.updateTask)
  const [events, setEvents] = useState<TaskEventData[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [showReportModal, setShowReportModal] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [updating, setUpdating] = useState(false)
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [statusValue, setStatusValue] = useState(task.status)
  const [statusReason, setStatusReason] = useState('')
  const [timelineCollapsed, setTimelineCollapsed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchTaskEvents(task.id).then((loaded) => {
      if (cancelled) return
      setEvents(loaded)
      const latestWithMd = loaded.find((ev) => {
        const payload = parseEventPayload(ev.payload_json)
        return typeof payload.report_md === 'string' && payload.report_md
      }) ?? loaded[0] ?? null
      setSelectedEventId(latestWithMd?.id ?? null)
    })
    return () => { cancelled = true }
  }, [task.id, fetchTaskEvents])

  const effectiveStatusValue = statusModalOpen ? statusValue : task.status

  const agent = task.assigned_agent_id ? agents.find((a) => a.id === task.assigned_agent_id) : null
  const currentMode = task.execution_mode_id ? modes.find((m) => m.id === task.execution_mode_id) : null
  const sortedEvents = [...events].sort((a, b) => b.sequence - a.sequence)
  const selectedEvent = selectedEventId ? sortedEvents.find((ev) => ev.id === selectedEventId) ?? null : sortedEvents[0] ?? null
  const selectedPayload = selectedEvent ? parseEventPayload(selectedEvent.payload_json) : {}
  const selectedReportMd = typeof selectedPayload.report_md === 'string'
    ? selectedPayload.report_md
    : typeof selectedPayload.message === 'string'
      ? selectedPayload.message
      : typeof selectedPayload.reason === 'string'
        ? selectedPayload.reason
        : ''
  const reportBadge = task.agent_report_status ? AGENT_REPORT_STATUS_BADGE[task.agent_report_status] ?? null : null
  const iterationCount = events.filter((ev) => ev.type === 'input_requested' || ev.type === 'marked_done').length

  const eventTitle = (ev: TaskEventData): string => {
    const p = parseEventPayload(ev.payload_json)
    if (ev.type === 'replied') return '人工回复'
    if (ev.type === 'input_requested') return '请求确认'
    if (ev.type === 'marked_done') return '标记完成'
    if (ev.type === 'milestone') return '里程碑汇报'
    if (ev.type === 'progress') return '更新进度'
    if (ev.type === 'self_claimed') return '自认领任务'
    if (ev.type === 'status_changed' || ev.type === 'manual_status_change') {
      const from = typeof p.from_status === 'string' ? p.from_status : '?'
      const to = typeof p.to_status === 'string' ? p.to_status : '?'
      return `状态: ${from} → ${to}`
    }
    if (ev.type === 'assigned' || ev.type === 'assigned_agent') return '分派 Agent'
    if (ev.type === 'created') return '创建任务'
    if (ev.type === 'session_linked') return '关联会话'
    return ev.type
  }

  const handleReply = async () => {
    if (!replyText.trim()) return
    setUpdating(true)
    try {
      await replyTask(task.id, replyText.trim())
      setReplyText('')
      setReplyOpen(false)
      const refreshed = await fetchTaskEvents(task.id)
      setEvents(refreshed)
      const latest = refreshed[0]
      if (latest) setSelectedEventId(latest.id)
    } finally { setUpdating(false) }
  }

  const openStatusModal = () => {
    setStatusValue(task.status)
    setStatusReason('')
    setStatusModalOpen(true)
  }

  const confirmStatusChange = async () => {
    setUpdating(true)
    try {
      await updateTask(task.id, effectiveStatusValue, undefined, statusReason.trim() || undefined)
      setStatusModalOpen(false)
      const refreshed = await fetchTaskEvents(task.id)
      setEvents(refreshed)
    } finally { setUpdating(false) }
  }

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(selectedReportMd)
    } catch { /* ignore */ }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Detail header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 6,
            color: 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
          }}
          title="返回任务列表"
        >
          <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, lineHeight: 1.3 }}>
          {task.title}
        </div>
      </div>

      {/* Detail body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 80px' }}>
        {/* Info rows */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 12px',
          background: 'var(--bg-1)',
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-3)', minWidth: 48, fontWeight: 500 }}>状态</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <span style={{
                fontSize: 11,
                color: 'white',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 10,
                background: taskStageColor(task.status),
              }}>
                {taskStageLabel(task.status)}
              </span>
              {reportBadge && (
                <span style={{
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 8,
                  background: reportBadge.bg,
                  color: reportBadge.color,
                  fontWeight: 500,
                }}>
                  {reportBadge.label}
                </span>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-3)', minWidth: 48, fontWeight: 500 }}>Agent</span>
            <span style={{ color: 'var(--text-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agent ? agent.name : '未指派'}
            </span>
          </div>
          {currentMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-3)', minWidth: 48, fontWeight: 500 }}>模式</span>
              <span style={{ color: 'var(--text-1)', flex: 1, minWidth: 0 }}>{currentMode.name}</span>
            </div>
          )}
          {task.stage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-3)', minWidth: 48, fontWeight: 500 }}>阶段</span>
              <span style={{
                color: 'var(--text-2)',
                fontSize: 12,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {task.stage}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-3)', minWidth: 48, fontWeight: 500 }}>会话</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {sessions.length === 0 ? (
                <span style={{ color: 'var(--text-3)' }}>无关联会话</span>
              ) : sessions.map((s) => {
                const sessionAgent = agents.find((a) => a.id === s.agent_id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onJumpToSession(s.id, s.agent_id)}
                    title={`跳转到会话: ${s.title ?? s.id}`}
                    style={{
                      border: '1px solid var(--blue)',
                      background: 'var(--blue-light)',
                      color: 'var(--blue)',
                      fontSize: 12,
                      padding: '2px 8px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      maxWidth: '100%',
                    }}
                  >
                    <MessageSquareIcon size={11} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                      {s.title?.trim() || (sessionAgent ? `${sessionAgent.name} 会话` : s.id.slice(0, 8))}
                    </span>
                  </button>
                )
              })}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-3)', minWidth: 48, fontWeight: 500 }}>迭代</span>
            <span style={{ color: 'var(--text-1)', flex: 1 }}>
              {iterationCount} 轮 · 创建于 {formatRelativeTime(task.created_at)}
            </span>
          </div>
        </div>

        {/* Timeline section */}
        <div style={{ marginBottom: 14 }}>
          <div
            onClick={() => setTimelineCollapsed((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 0',
              marginBottom: 6,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={12} />
              历史时间线
              <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 500 }}>({events.length})</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{timelineCollapsed ? '展开' : '收起'}</span>
          </div>
          {!timelineCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 4 }}>
              {sortedEvents.length === 0 && (
                <div style={{ padding: '14px', fontSize: 12, color: 'var(--text-3)' }}>暂无记录</div>
              )}
              {sortedEvents.map((ev, idx) => {
                const meta = TASK_EVENT_TYPE_META[ev.type] ?? { label: ev.type, color: 'var(--text-3)', bg: 'var(--bg-2)' }
                const isSelected = selectedEvent?.id === ev.id
                const isLast = idx === 0
                return (
                  <div
                    key={ev.id}
                    onClick={() => setSelectedEventId(ev.id)}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '6px 4px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      position: 'relative',
                      background: isSelected ? 'var(--blue-light)' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                  >
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: isSelected ? 'var(--blue)' : meta.color,
                      marginTop: 5,
                      flexShrink: 0,
                      border: '2px solid var(--bg-0)',
                      position: 'relative',
                      zIndex: 1,
                    }} />
                    {!isLast && (
                      <div style={{
                        position: 'absolute',
                        left: 7,
                        top: 14,
                        bottom: -6,
                        width: 1,
                        background: 'var(--border)',
                      }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 8,
                          background: meta.bg,
                          color: meta.color,
                          whiteSpace: 'nowrap',
                        }}>
                          {meta.label}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-4)', marginLeft: 'auto' }}>
                          {formatRelativeTime(ev.created_at)}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 12,
                        color: 'var(--text-2)',
                        lineHeight: 1.4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {eventTitle(ev)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Report preview */}
        {selectedReportMd && (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 0',
              marginBottom: 6,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={12} />
                汇报内容
              </div>
            </div>
            <div
              onClick={() => setShowReportModal(true)}
              style={{
                position: 'relative',
                background: 'var(--bg-1)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '10px 12px',
                maxHeight: 140,
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--blue)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <div style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 50,
                background: 'linear-gradient(transparent, var(--bg-1))',
                pointerEvents: 'none',
              }} />
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-1)', maxHeight: 120, overflow: 'hidden' }}>
                <MarkdownRenderer content={selectedReportMd} />
              </div>
              <span style={{
                position: 'absolute',
                right: 8,
                bottom: 6,
                fontSize: 11,
                color: 'var(--blue)',
                fontWeight: 500,
                background: 'var(--bg-0)',
                padding: '2px 8px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                zIndex: 1,
              }}>
                点击放大
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '10px 14px',
        display: 'flex',
        gap: 8,
        flexShrink: 0,
        background: 'var(--bg-0)',
      }}>
        <button
          type="button"
          onClick={openStatusModal}
          disabled={updating}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-1)',
            color: 'var(--text-2)',
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          改状态
        </button>
        {task.status === 'needs_input' && (
          <button
            type="button"
            onClick={() => setReplyOpen((v) => !v)}
            disabled={updating}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--blue)',
              color: 'white',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <MessageSquareIcon size={12} />
            回复 AI
          </button>
        )}
      </div>

      {/* Reply box */}
      {replyOpen && task.status === 'needs_input' && (
        <div style={{
          padding: '0 14px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: 'var(--bg-0)',
        }}>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="回复内容,AI 会继续执行..."
            style={{
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 13,
              resize: 'vertical',
              minHeight: 60,
              background: 'var(--bg-1)',
              color: 'var(--text-1)',
              outline: 'none',
              boxSizing: 'border-box',
              width: '100%',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              type="button"
              onClick={() => { setReplyOpen(false); setReplyText('') }}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-3)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleReply}
              disabled={updating || !replyText.trim()}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: 'none',
                background: updating || !replyText.trim() ? 'var(--bg-2)' : 'var(--blue)',
                color: updating || !replyText.trim() ? 'var(--text-3)' : 'white',
                fontSize: 13,
                fontWeight: 500,
                cursor: updating || !replyText.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {updating ? '发送中...' : '发送'}
            </button>
          </div>
        </div>
      )}

      {/* Report markdown modal */}
      {showReportModal && selectedReportMd && (
        <>
          <div
            onClick={() => setShowReportModal(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 40,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--bg-0)',
                borderRadius: 12,
                width: '100%',
                maxWidth: 900,
                maxHeight: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>汇报内容</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {task.title}
                    {selectedEvent && ` · ${formatRelativeTime(selectedEvent.created_at)}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  style={{
                    width: 28,
                    height: 28,
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
                  <X size={16} />
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
                <MarkdownRenderer content={selectedReportMd} />
              </div>
              <div style={{
                padding: '10px 20px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
                background: 'var(--bg-1)',
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Markdown 渲染 · 共 {events.length} 个事件
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={copyReport}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-0)',
                      color: 'var(--text-2)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    复制原文
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-3)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Status change modal */}
      {statusModalOpen && (
        <>
          <div
            onClick={() => setStatusModalOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1100 }}
          />
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 360,
            background: 'var(--bg-0)',
            borderRadius: 10,
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1101,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>修改任务状态</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {TASK_STATUS_OPTIONS.map((opt) => {
                const active = effectiveStatusValue === opt.status
                return (
                  <button
                    key={opt.status}
                    type="button"
                    onClick={() => setStatusValue(opt.status)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      border: active ? '1px solid var(--blue)' : '1px solid transparent',
                      background: active ? 'var(--blue-light)' : 'transparent',
                      color: active ? 'var(--blue)' : 'var(--text-1)',
                      fontWeight: active ? 500 : 400,
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.dot }} />
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <textarea
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="原因(可选)"
              rows={2}
              style={{
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 13,
                resize: 'none',
                background: 'var(--bg-1)',
                color: 'var(--text-1)',
                outline: 'none',
                boxSizing: 'border-box',
                width: '100%',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStatusModalOpen(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-3)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmStatusChange}
                disabled={updating || effectiveStatusValue === task.status}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: updating || effectiveStatusValue === task.status ? 'var(--bg-2)' : 'var(--blue)',
                  color: updating || effectiveStatusValue === task.status ? 'var(--text-3)' : 'white',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: updating || effectiveStatusValue === task.status ? 'not-allowed' : 'pointer',
                }}
              >
                {updating ? '更新中...' : '确认'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const TASK_STATUS_OPTIONS: Array<{ status: string; label: string; dot: string }> = [
  { status: 'backlog', label: '待办', dot: 'var(--text-3)' },
  { status: 'executing', label: '行动中', dot: 'var(--blue)' },
  { status: 'needs_input', label: '需确认', dot: '#f59e0b' },
  { status: 'completed', label: '已完成', dot: 'var(--green)' },
  { status: 'cancelled', label: '已取消', dot: 'var(--text-3)' },
]

/* ─── Tool Call Panel ─── */
function ToolCallPanel({
  tc,
  hasDetail,
  detailLoading,
  detailError,
  onLoadDetail,
}: {
  tc: ToolCallInfo
  isStreaming: boolean
  hasDetail?: boolean
  detailLoading?: boolean
  detailError?: string
  onLoadDetail?: () => void
}) {
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
  useEffect(() => {
    if (open && hasDetail && !detailLoading && !detailError) onLoadDetail?.()
  }, [detailError, detailLoading, hasDetail, onLoadDetail, open])
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
          {detailLoading && <div style={{ color: 'var(--text-3)', marginBottom: 6 }}>正在加载工具详情...</div>}
          {detailError && <div style={{ color: 'var(--red)', marginBottom: 6, overflowWrap: 'anywhere' }}>{detailError}</div>}
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
  started_at?: string | null
  completed_at?: string | null
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
  onLoadProcessItemDetail,
  fileChangeDetailsByMessageId = {},
  fileChangeLoadingByKey = {},
  fileChangeErrorByKey = {},
  processItemLoadingByKey = {},
  processItemErrorByKey = {},
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
  onLoadProcessItemDetail?: (sessionId: string, messageId: string, itemId: string) => void
  fileChangeDetailsByMessageId?: Record<string, FileChangeDetailInfo>
  fileChangeLoadingByKey?: Record<string, boolean>
  fileChangeErrorByKey?: Record<string, string>
  processItemLoadingByKey?: Record<string, boolean>
  processItemErrorByKey?: Record<string, string>
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
  const messageElapsedSeconds = !isTimelineGroup
    ? elapsedSecondsBetween(normalizedMessage.started_at, normalizedMessage.completed_at)
    : undefined
  const elapsedSeconds = turnStats?.elapsedSeconds ?? (streaming ? liveElapsedSeconds : messageElapsedSeconds)
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
                renderProcessBlock={(block) => {
                  const processItemKey = !isTimelineGroup ? `${normalizedMessage.id}:${block.id}` : ''
                  const loadDetail = !isTimelineGroup && normalizedMessage.session_id
                    ? () => onLoadProcessItemDetail?.(normalizedMessage.session_id!, normalizedMessage.id, block.id)
                    : undefined
                  return (
                    <ProcessBlockView
                      key={block.id}
                      block={block}
                      isStreaming={isStreaming}
                      detailLoading={!!processItemLoadingByKey[processItemKey]}
                      detailError={processItemErrorByKey[processItemKey]}
                      onLoadDetail={loadDetail}
                    />
                  )
                }}
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

const MemoChatBubble = memo(ChatBubble)

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

function ProcessBlockView({
  block,
  isStreaming,
  detailLoading,
  detailError,
  onLoadDetail,
}: {
  block: TurnProcessBlock
  isStreaming: boolean
  detailLoading?: boolean
  detailError?: string
  onLoadDetail?: () => void
}) {
  const needsDetail = processBlockNeedsDetail(block)
  const shouldAutoLoadDetail = needsDetail && block.kind !== 'tool'
  useEffect(() => {
    if (shouldAutoLoadDetail && !detailLoading && !detailError) onLoadDetail?.()
  }, [detailError, detailLoading, onLoadDetail, shouldAutoLoadDetail])

  if (block.kind === 'tool') {
    const diffEntries = toolBlockHasDiff(block.toolCall)
      ? extractFileChangesFromToolCall(block.toolCall)
      : []
    return (
      <>
        <ToolCallPanel
          tc={block.toolCall}
          isStreaming={isStreaming}
          hasDetail={needsDetail}
          detailLoading={detailLoading}
          detailError={detailError}
          onLoadDetail={onLoadDetail}
        />
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
        <ProcessDetailState loading={detailLoading} error={detailError} />
        <div style={{ color: 'var(--text-3)' }}>{block.summary || '文件修改详情按需加载'}</div>
      </div>
    )
  }
  if (block.kind === 'plan') {
    return (
      <div style={{ borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', padding: '8px 10px', fontSize: 14, color: 'var(--text-2)' }}>
        <ProcessDetailState loading={detailLoading} error={detailError} />
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
  if (block.kind === 'permission') {
    return (
      <div style={{ borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', padding: '8px 10px', fontSize: 14, color: 'var(--text-2)' }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>权限请求</div>
        <ProcessDetailState loading={detailLoading} error={detailError} />
        <div style={{ overflowWrap: 'anywhere' }}>
          {block.summary || block.request?.toolCall.title || '需要确认工具权限'}
        </div>
        {(block.preview || block.request?.options.length) && (
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-3)' }}>
            {block.preview || block.request?.options.map((option) => option.name).join(' / ')}
          </div>
        )}
      </div>
    )
  }
  if (block.kind === 'elicitation') {
    return (
      <div style={{ borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', padding: '8px 10px', fontSize: 14, color: 'var(--text-2)' }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>AI 提问</div>
        <ProcessDetailState loading={detailLoading} error={detailError} />
        <div style={{ overflowWrap: 'anywhere' }}>
          {block.message || block.summary || block.preview || '需要补充信息'}
        </div>
      </div>
    )
  }
  return <ProcessNoteBlock text={block.text} />
}

function ProcessDetailState({ loading, error }: { loading?: boolean; error?: string }) {
  if (!loading && !error) return null
  return (
    <div style={{ marginBottom: 6, fontSize: 13, color: error ? 'var(--red)' : 'var(--text-3)', overflowWrap: 'anywhere' }}>
      {error || '\u6b63\u5728\u52a0\u8f7d\u8be6\u60c5...'}
    </div>
  )
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
              src={imageAttachmentSrc(img)}
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
function imageAttachmentSrc(img: ImageAttachmentInfo): string {
  return img.data ? `data:${img.mimeType};base64,${img.data}` : withCurrentToken(img.url || '')
}

function withCurrentToken(url: string): string {
  if (!url || typeof window === 'undefined') return url
  const token = new URLSearchParams(window.location.search).get('token')
  if (!token) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}token=${encodeURIComponent(token)}`
}

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

function readAgentModelProfileId(agent: AgentData): string {
  if (!agent.config_json) return ''
  try {
    const config = JSON.parse(agent.config_json) as { modelProfileId?: unknown }
    return typeof config.modelProfileId === 'string' ? config.modelProfileId : ''
  } catch {
    return ''
  }
}

function AgentModelProfileDialog({
  agent,
  profiles,
  onLoadProfiles,
  onSave,
  onClose,
}: {
  agent: AgentData
  profiles: ModelProfileData[]
  onLoadProfiles: () => void
  onSave: (modelProfileId: string | null) => Promise<void>
  onClose: () => void
}) {
  const availableProfiles = useMemo(
    () => profiles.filter((profile) => profile.enabled && profile.runtime === agent.runtime),
    [agent.runtime, profiles],
  )
  const currentProfileId = readAgentModelProfileId(agent)
  const [modelProfileId, setModelProfileId] = useState(currentProfileId)
  const [saving, setSaving] = useState(false)

  useEffect(() => { onLoadProfiles() }, [onLoadProfiles])
  const selectedModelProfileId = availableProfiles.some((profile) => profile.id === modelProfileId) ? modelProfileId : ''

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(selectedModelProfileId || null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', zIndex: 1000 }} />
      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 420,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--bg-0)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          zIndex: 1001,
          padding: 22,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>模型档案</h3>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-3)' }}>
            为「{agent.name}」单独绑定 Claude Code / Codex 的模型配置。
          </p>
        </div>
        <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
          选择档案
        </label>
        <select
          value={selectedModelProfileId}
          onChange={(event) => setModelProfileId(event.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-1)',
            color: 'var(--text-1)',
            outline: 'none',
            fontSize: 14,
          }}
        >
          <option value="">不绑定模型档案</option>
          {availableProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}{profile.is_default ? '（默认）' : ''}
            </option>
          ))}
        </select>
        {availableProfiles.length === 0 && (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-3)' }}>
            当前运行时暂无可用模型档案，可先到设置页新增。
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', cursor: 'pointer' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--blue)', background: 'var(--blue)', color: '#fff', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.65 : 1 }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </>
  )
}

/* ─── New Task Modal ─── */
const WORKSPACE_TASK_SESSION_MODE_OPTIONS: Array<{ value: SessionMode; label: string }> = [
  { value: 'new_fixed', label: '固定新会话' },
  { value: 'new_each', label: '每次新会话' },
  { value: 'existing', label: '指定已有会话' },
]

function workspaceTaskSessionModeHelp(mode: SessionMode, hasSession: boolean): string {
  if (mode === 'existing') return hasSession ? '将在该会话中追加任务指派。' : '请选择一个已有会话。'
  if (mode === 'new_fixed') return '将创建一个新的固定会话用于这次任务。'
  return '将为这次任务创建新的会话。'
}

function NewTaskModal({
  agents,
  projectId,
  onCreate,
  onClose,
}: {
  agents: AgentData[]
  projectId: string | null
  onCreate: (title: string, desc?: string, agentId?: string, sessionId?: string, sessionMode?: SessionMode, images?: ImageAttachmentInfo[]) => Promise<TaskData>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [agentId, setAgentId] = useState('')
  const [sessionMode, setSessionMode] = useState<SessionMode>('new_fixed')
  const [sessionId, setSessionId] = useState('')
  const [images, setImages] = useState<ImageAttachmentInfo[]>([])
  const [creating, setCreating] = useState(false)
  const sessions = useSessionStore((s) => s.sessions)
  const agentSessions = useMemo(() => {
    if (!agentId) return []
    return sessions.filter((session) =>
      session.agent_id === agentId &&
      (!projectId || session.project_id === projectId),
    )
  }, [agentId, projectId, sessions])
  const canCreate = Boolean(title.trim()) && (!agentId || sessionMode !== 'existing' || Boolean(sessionId))
  const handleCreate = async () => {
    if (!canCreate) return
    setCreating(true)
    try {
      const target = buildWorkspaceTaskCreateTarget({ agentId, sessionMode, sessionId })
      await onCreate(title, desc || undefined, target.agentId, target.sessionId, target.sessionMode, images)
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
          <TaskImageInput images={images} onChange={setImages} />
          <div>
            <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>
              指派 Agent
            </label>
            <select
              value={agentId}
              onChange={(e) => {
                setAgentId(e.target.value)
                setSessionMode('new_fixed')
                setSessionId('')
              }}
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
          {agentId && (
            <div>
              <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>
                会话目标
              </label>
              <select
                value={sessionMode}
                onChange={(e) => {
                  setSessionMode(e.target.value as SessionMode)
                  setSessionId('')
                }}
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
                {WORKSPACE_TASK_SESSION_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {sessionMode === 'existing' && (
                <select
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    fontSize: 15,
                    background: 'var(--bg-1)',
                    color: 'var(--text-1)',
                    outline: 'none',
                    marginTop: 8,
                  }}
                >
                  <option value="">请选择已有会话</option>
                  {agentSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {sessionTitle(session)}
                    </option>
                  ))}
                </select>
              )}
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                {workspaceTaskSessionModeHelp(sessionMode, Boolean(sessionId))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleCreate}
              disabled={!canCreate || creating}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--blue)',
                color: 'white',
                fontSize: 15,
                fontWeight: 500,
                cursor: canCreate && !creating ? 'pointer' : 'not-allowed',
                opacity: canCreate ? 1 : 0.5,
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
