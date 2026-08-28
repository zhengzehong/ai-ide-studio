import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSessionStore } from '../stores/session.store'
import { isSecretarySessionPurpose } from '@desktop/stores/secretary-session'
import { useAppStore } from '../stores/app.store'
import { useMobileProjectSessionStatsStore } from '../stores/project-session-stats.store'
import type { MobileSessionItem } from '../stores/session.store'
import { buildStableAgentGroups, sortProjectsByCreation } from './session-list-model'
import SessionGroup from '../components/SessionGroup'
import ProjectDrawer from '../components/ProjectDrawer'
import { useEdgeSwipe } from '../hooks/useEdgeSwipe'
import { usePinnedSessionStore } from '../stores/pinned-session.store'
import { PinnedSessionList } from './PinnedSessionsPage'
import { resolveSessionViewMode, sessionViewPath } from './session-view-mode'
import { SessionListTopbar } from '../components/session-list/SessionListTopbar'
import { SessionListOverlays } from '../components/session-list/SessionListOverlays'
import { buildSessionActionItems } from '../components/session-list/session-list-actions'
import { sessionListStyles as styles } from './session-list-styles'

export default function SessionListPage() {
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
  } = useAppStore()
  const statsByProjectId = useMobileProjectSessionStatsStore((state) => state.statsByProjectId)
  const pinnedItems = usePinnedSessionStore((state) => state.items)
  const addPinned = usePinnedSessionStore((state) => state.add)
  const removePinned = usePinnedSessionStore((state) => state.remove)
  const loadPinned = usePinnedSessionStore((state) => state.load)
  const navigate = useNavigate()
  const location = useLocation()
  const viewMode = resolveSessionViewMode(location.search)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [createSheetOpen, setCreateSheetOpen] = useState(false)
  const [actionSession, setActionSession] = useState<MobileSessionItem | null>(null)
  const [renameTarget, setRenameTarget] = useState<MobileSessionItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MobileSessionItem | null>(null)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [publishSession, setPublishSession] = useState<MobileSessionItem | null>(null)

  const drawerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (viewMode !== 'all') return
    fetchSessions(currentProjectId)
    fetchAgents(currentProjectId ?? undefined)
  }, [currentProjectId, fetchSessions, fetchAgents, viewMode])

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status === 'active' && !isSecretarySessionPurpose(s.purpose)),
    [sessions],
  )

  const sortedProjects = useMemo(() => sortProjectsByCreation(projects), [projects])

  const agentGroups = useMemo(
    () => buildStableAgentGroups(agents, activeSessions),
    [agents, activeSessions],
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
    void renameSession(target.id, title)
  }

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    void deleteSession(target.id)
  }

  const actionItems = buildSessionActionItems({
    session: actionSession,
    pinned: !!actionSession && pinnedItems.some((item) => item.sessionId === actionSession.id),
    onTogglePinned: () => { if (actionSession) togglePinned(actionSession.id) },
    onRename: () => setRenameTarget(actionSession),
    onPublishTemplate: () => { if (actionSession) handlePublishTemplate(actionSession) },
    onArchive: () => { if (actionSession) void archiveSession(actionSession.id) },
    onClose: () => { if (actionSession) void closeSession(actionSession.id) },
    onDelete: () => setDeleteTarget(actionSession),
  })

  const showEmpty = agentGroups.length === 0 && !loading

  return (
    <div
      ref={containerRef}
      style={styles.page}
      onPointerDown={viewMode === 'all' ? edgeSwipe.onPointerDown : undefined}
    >
      {viewMode === 'all' && (
        <>
          <ProjectDrawer
            projects={sortedProjects}
            currentProjectId={currentProjectId}
            isOpen={drawerOpen}
            isPinned={isDrawerPinned}
            onPickProject={handlePickProject}
            onTogglePin={handleTogglePin}
            onCreateProject={() => {
              if (!isDrawerPinned) setDrawerOpen(false)
              setCreateSheetOpen(true)
            }}
            onManageProjects={handleManageProjects}
            drawerRef={drawerRef}
            overlayRef={overlayRef}
            projectUnread={projectUnread}
            totalSessions={totalSessions}
          />
          <div style={styles.overlay} onClick={handleCloseDrawer} data-visible={drawerOpen && !isDrawerPinned ? '1' : '0'} />
        </>
      )}

      <div
        style={{
          ...styles.mainArea,
          ...(viewMode === 'all' && isDrawerPinned ? styles.mainAreaPinned : {}),
        }}
      >
        <SessionListTopbar
          mode={viewMode}
          project={currentProject}
          pinnedCount={pinnedItems.length}
          isDrawerPinned={isDrawerPinned}
          onOpenDrawer={handleOpenDrawer}
          onNewSession={handleNewSession}
          onRefreshPinned={() => { void loadPinned() }}
          onToggleMode={handleToggleMode}
        />

        {viewMode === 'pinned' ? <PinnedSessionList /> : (
          <div style={styles.list}>
            {showEmpty && (
              <div style={styles.empty}>
                <MessageSquarePlus size={40} color="var(--text-muted)" strokeWidth={1.2} />
                <span style={styles.emptyText}>暂无会话</span>
              </div>
            )}
            {agentGroups.map((group) => (
              <SessionGroup key={group.agentId} agentId={group.agentId} agentName={group.agentName} sessions={group.sessions} onLongPress={handleLongPress} />
            ))}
          </div>
        )}
      </div>

      <SessionListOverlays
        currentProjectId={currentProjectId}
        createSheetOpen={createSheetOpen}
        actionSession={actionSession}
        actionItems={actionItems}
        renameTarget={renameTarget}
        deleteTarget={deleteTarget}
        newSessionOpen={newSessionOpen}
        publishSession={publishSession}
        onCloseCreate={() => setCreateSheetOpen(false)}
        onCreatedProject={handleCreatedProject}
        onCloseAction={() => setActionSession(null)}
        onRenameConfirm={handleRenameConfirm}
        onCloseRename={() => setRenameTarget(null)}
        onDeleteConfirm={handleDeleteConfirm}
        onCloseDelete={() => setDeleteTarget(null)}
        onCloseNewSession={() => setNewSessionOpen(false)}
        onNewBlank={handleNewBlankFromSheet}
        onInstantiated={handleNewFromTemplateSheet}
        onClosePublish={() => setPublishSession(null)}
      />
    </div>
  )
}
