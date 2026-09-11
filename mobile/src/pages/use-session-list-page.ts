import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSessionStore } from '../stores/session.store'
import { isUserVisibleSession } from '../../../src/shared/session-visibility'
import { useAppStore } from '../stores/app.store'
import { useMobileProjectSessionStatsStore } from '../stores/project-session-stats.store'
import type { MobileSessionItem } from '../stores/session.store'
import { buildStableAgentGroups, sortProjectsByCreation } from './session-list-model'
import { useEdgeSwipe } from '../hooks/useEdgeSwipe'
import { usePinnedSessionStore } from '../stores/pinned-session.store'
import { resolveInitialViewMode, sessionViewPath } from './session-view-mode'
import { buildSessionActionItems } from '../components/session-list/session-list-actions'
import { useConversationCatalog } from '../stores/conversation-catalog.store'
import { mergeMobileConversations, mergeMobileOwners, sortConversationGroups } from '../utils/team-conversations'
import { wsClient } from '@desktop/services/ws-client'
import { showToast } from '../utils/toast'

export function useSessionListPage() {
  const {
    sessions,
    loading,
    fetchSessions,
    renameSession,
    archiveSession,
    closeSession,
    deleteSession,
  } = useSessionStore()
  const {
    projects,
    agents,
    currentProjectId,
    setCurrentProject,
    isDrawerPinned,
    setDrawerPinned,
    fetchAgents,
    sessionViewMode,
    setSessionViewMode,
  } = useAppStore()
  const statsByProjectId = useMobileProjectSessionStatsStore((state) => state.statsByProjectId)
  const pinnedItems = usePinnedSessionStore((state) => state.items)
  const addPinned = usePinnedSessionStore((state) => state.add)
  const removePinned = usePinnedSessionStore((state) => state.remove)
  const loadPinned = usePinnedSessionStore((state) => state.load)
  const navigate = useNavigate()
  const catalog = useConversationCatalog(state => state.catalog)
  const catalogError = useConversationCatalog(state => state.error)
  const catalogLoaded = useConversationCatalog(state => state.loaded)
  const owners = useMemo(() => mergeMobileOwners(agents, catalog, currentProjectId), [agents, catalog, currentProjectId])
  const unifiedSessions = useMemo(() => mergeMobileConversations(sessions, catalog, currentProjectId), [sessions, catalog, currentProjectId])
  const teamAction = async (session: MobileSessionItem, action: 'rename' | 'archive' | 'delete', title?: string): Promise<void> => {
    try {
      await wsClient.request({ type: `team.conversation.${action}`, conversationId: session.conversationId, ...(title ? { title } : {}) })
      await useConversationCatalog.getState().load()
      await loadPinned({ silent: true })
    } catch (error) { showToast(error instanceof Error ? error.message : '团队会话操作失败') }
  }
  const location = useLocation()
  const viewMode = resolveInitialViewMode(location.search, sessionViewMode)

  // URL 缺 view 参数时(如从其他 tab 返回)回写地址栏并沿用上次视图;带参数时同步到本地
  useEffect(() => {
    const param = new URLSearchParams(location.search).get('view')
    if (param === 'pinned' || param === 'all') {
      setSessionViewMode(param)
    } else if (viewMode === 'pinned') {
      navigate(sessionViewPath('pinned'), { replace: true })
    }
  }, [location.search, viewMode, navigate, setSessionViewMode])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [createSheetOpen, setCreateSheetOpen] = useState(false)
  const [actionSession, setActionSession] = useState<MobileSessionItem | null>(null)
  const [renameTarget, setRenameTarget] = useState<MobileSessionItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MobileSessionItem | null>(null)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [publishSession, setPublishSession] = useState<MobileSessionItem | null>(null)
  // Agent 分组头长按 → 设置该 Agent 的模型档案
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null)
  const [agentSheetOpen, setAgentSheetOpen] = useState(false)
  const [profileSheetOpen, setProfileSheetOpen] = useState(false)

  const drawerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (viewMode !== 'all') return
    fetchSessions(currentProjectId)
    fetchAgents(currentProjectId ?? undefined)
  }, [currentProjectId, fetchSessions, fetchAgents, viewMode])

  const activeSessions = useMemo(
    () => unifiedSessions.filter((s) => s.status === 'active' && isUserVisibleSession(s)),
    [unifiedSessions],
  )

  const sortedProjects = useMemo(() => sortProjectsByCreation(projects), [projects])

  const agentGroups = useMemo(
    () => sortConversationGroups(buildStableAgentGroups(owners, activeSessions), pinnedItems.map(item => item.sessionId)),
    [owners, activeSessions, pinnedItems],
  )

  const projectUnread = useMemo(() => {
    const map: Record<string, number> = {}
    for (const stats of Object.values(statsByProjectId)) {
      map[stats.projectId] = stats.unreadCount
    }
    return map
  }, [statsByProjectId])

  const totalSessions = useMemo(() => {
    const map: Record<string, number> = {}
    for (const stats of Object.values(statsByProjectId)) {
      map[stats.projectId] = stats.sessionCount
    }
    return map
  }, [statsByProjectId])

  const currentProject = useMemo(
    () => sortedProjects.find((p) => p.id === currentProjectId),
    [sortedProjects, currentProjectId],
  )

  const edgeSwipe = useEdgeSwipe({
    drawerEl: drawerRef,
    overlayEl: overlayRef,
    containerEl: containerRef,
    isOpen: drawerOpen,
    isPinned: isDrawerPinned,
    onOpen: () => setDrawerOpen(true),
    onClose: () => setDrawerOpen(false),
  })

  const handleOpenDrawer = () => {
    if (isDrawerPinned) return
    setDrawerOpen(true)
  }

  const handleCloseDrawer = () => setDrawerOpen(false)

  const handlePickProject = (id: string) => {
    setCurrentProject(id)
    fetchSessions(id)
    fetchAgents(id)
    if (!isDrawerPinned) setDrawerOpen(false)
  }

  const handleTogglePin = () => {
    const next = !isDrawerPinned
    setDrawerPinned(next)
    if (next) setDrawerOpen(false)
  }

  const handleCreatedProject = (projectId: string) => {
    setCurrentProject(projectId)
    fetchSessions(projectId)
    fetchAgents(projectId)
  }

  const handleNewSession = () => {
    if (!currentProjectId) {
      setCreateSheetOpen(true)
      return
    }
    setNewSessionOpen(true)
  }

  const handleNewBlankFromSheet = (agentId: string) => {
    if (!currentProjectId) return
    navigate(`/chat/new?projectId=${currentProjectId}&agentId=${agentId}`)
  }

  const handleNewFromTemplateSheet = (sessionId: string) => {
    navigate(`/chat/${sessionId}`)
  }

  const handlePublishTemplate = (session: MobileSessionItem) => {
    setPublishSession(session)
  }

  const handleManageProjects = () => {
    if (!isDrawerPinned) setDrawerOpen(false)
    navigate('/settings')
  }

  const handleLongPress = (session: MobileSessionItem) => {
    setActionSession(session)
  }

  const handleHeaderLongPress = (agentId: string) => {
    setProfileAgentId(agentId)
    setAgentSheetOpen(true)
  }

  const profileAgent = useMemo(
    () => agents.find((agent) => agent.id === profileAgentId) ?? null,
    [agents, profileAgentId],
  )

  const profileAgentSheetItems = useMemo(() => [
    {
      key: 'model-profile',
      label: '模型档案',
      onClick: () => setProfileSheetOpen(true),
    },
  ], [])

  const handleToggleMode = (): void => {
    navigate(sessionViewPath(viewMode === 'all' ? 'pinned' : 'all'), { replace: true })
  }

  const togglePinned = (sessionId: string): void => {
    if (pinnedItems.some((item) => item.sessionId === sessionId)) {
      void removePinned(sessionId)
    } else {
      void addPinned(sessionId)
    }
  }

  const handleRenameConfirm = (title: string) => {
    if (!renameTarget) return
    const target = renameTarget
    setRenameTarget(null)
    if (target.conversationId) void teamAction(target, 'rename', title)
    else void renameSession(target.id, title)
  }

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    if (target.conversationId) void teamAction(target, 'delete')
    else void deleteSession(target.id)
  }

  const actionItems = buildSessionActionItems({
    session: actionSession,
    pinned: !!actionSession && pinnedItems.some((item) => item.sessionId === actionSession.id),
    onTogglePinned: () => { if (actionSession) togglePinned(actionSession.id) },
    onRename: () => setRenameTarget(actionSession),
    onPublishTemplate: () => { if (actionSession) handlePublishTemplate(actionSession) },
    onArchive: () => { if (actionSession) { if (actionSession.conversationId) void teamAction(actionSession, 'archive'); else void archiveSession(actionSession.id) } },
    onClose: () => { if (actionSession && !actionSession.conversationId) void closeSession(actionSession.id) },
    onDelete: () => setDeleteTarget(actionSession),
  })

  const showEmpty = agentGroups.length === 0 && !loading && catalogLoaded

  return { setDrawerOpen, containerRef, viewMode, edgeSwipe, sortedProjects, currentProjectId, drawerOpen, isDrawerPinned, handlePickProject, handleTogglePin, handleCloseDrawer, setCreateSheetOpen, handleManageProjects, drawerRef, overlayRef, projectUnread, totalSessions, currentProject, pinnedItems, catalog, handleOpenDrawer, handleNewSession, loadPinned, handleToggleMode, catalogError, showEmpty, catalogLoaded, agentGroups, owners, handleLongPress, handleHeaderLongPress, createSheetOpen, actionSession, actionItems, renameTarget, deleteTarget, newSessionOpen, publishSession, handleCreatedProject, setActionSession, handleRenameConfirm, setRenameTarget, handleDeleteConfirm, setDeleteTarget, setNewSessionOpen, handleNewBlankFromSheet, handleNewFromTemplateSheet, setPublishSession, agentSheetOpen, profileAgent, profileAgentSheetItems, setAgentSheetOpen, profileSheetOpen, setProfileSheetOpen }
}
