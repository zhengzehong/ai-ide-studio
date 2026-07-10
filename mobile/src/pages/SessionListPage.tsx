import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Archive, Edit3, MessageSquarePlus, Plus, Search, Trash2, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from '../stores/session.store'
import { useAppStore } from '../stores/app.store'
import type { MobileSessionItem } from '../stores/session.store'
import SessionGroup from '../components/SessionGroup'
import ProjectSwitcher from '../components/ProjectSwitcher'
import ProjectDrawer from '../components/ProjectDrawer'
import ProjectCreateSheet from '../components/ProjectCreateSheet'
import ActionSheet from '../components/ActionSheet'
import ConfirmDialog from '../components/ConfirmDialog'
import RenameDialog from '../components/RenameDialog'
import { useEdgeSwipe } from '../hooks/useEdgeSwipe'

interface AgentGroup {
  agentId: string
  agentName: string
  sessions: MobileSessionItem[]
  unreadCount: number
  runningCount: number
}

function groupByAgent(sessions: MobileSessionItem[]): AgentGroup[] {
  const map = new Map<string, AgentGroup>()
  for (const session of sessions) {
    if (session.status !== 'active') continue
    const existing = map.get(session.agentId)
    if (existing) {
      existing.sessions.push(session)
      if (session.unread) existing.unreadCount += 1
      if (session.activityState === 'running') existing.runningCount += 1
    } else {
      map.set(session.agentId, {
        agentId: session.agentId,
        agentName: session.agentName,
        sessions: [session],
        unreadCount: session.unread ? 1 : 0,
        runningCount: session.activityState === 'running' ? 1 : 0,
      })
    }
  }
  const groups = [...map.values()]
  groups.sort((a, b) => {
    const aActive = a.unreadCount > 0 || a.runningCount > 0
    const bActive = b.unreadCount > 0 || b.runningCount > 0
    if (aActive !== bActive) return aActive ? -1 : 1
    return a.agentName.localeCompare(b.agentName, 'zh-CN')
  })
  return groups
}

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
    currentProjectId,
    setCurrentProject,
    isDrawerPinned,
    setDrawerPinned,
  } = useAppStore()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [createSheetOpen, setCreateSheetOpen] = useState(false)
  const [actionSession, setActionSession] = useState<MobileSessionItem | null>(null)
  const [renameTarget, setRenameTarget] = useState<MobileSessionItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MobileSessionItem | null>(null)

  const drawerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    fetchSessions(currentProjectId)
  }, [currentProjectId, fetchSessions])

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status === 'active'),
    [sessions],
  )

  const agentGroups = useMemo(() => groupByAgent(activeSessions), [activeSessions])

  const projectUnread = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of activeSessions) {
      if (s.unread && s.projectId) {
        map[s.projectId] = (map[s.projectId] ?? 0) + 1
      }
    }
    return map
  }, [activeSessions])

  const totalSessions = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of activeSessions) {
      if (s.projectId) {
        map[s.projectId] = (map[s.projectId] ?? 0) + 1
      }
    }
    return map
  }, [activeSessions])

  const currentProject = useMemo(
    () => projects.find((p) => p.id === currentProjectId),
    [projects, currentProjectId],
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
  }

  const handleNewSession = () => {
    if (!currentProjectId) {
      setCreateSheetOpen(true)
      return
    }
    navigate(`/chat/new?projectId=${currentProjectId}`)
  }

  const handleSearch = () => {
    // placeholder for search entry
  }

  const handleManageProjects = () => {
    if (!isDrawerPinned) setDrawerOpen(false)
    navigate('/settings')
  }

  const handleLongPress = (session: MobileSessionItem) => {
    setActionSession(session)
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

  const actionItems = actionSession
    ? [
        {
          key: 'rename',
          label: '重命名',
          icon: <Edit3 size={18} color="#191919" />,
          onClick: () => setRenameTarget(actionSession),
        },
        {
          key: 'archive',
          label: '归档',
          icon: <Archive size={18} color="#191919" />,
          onClick: () => void archiveSession(actionSession.id),
        },
        {
          key: 'close',
          label: '关闭会话',
          icon: <XCircle size={18} color="#191919" />,
          onClick: () => void closeSession(actionSession.id),
        },
        {
          key: 'delete',
          label: '删除会话',
          icon: <Trash2 size={18} color="#fa5151" />,
          danger: true,
          onClick: () => setDeleteTarget(actionSession),
        },
      ]
    : []

  const showEmpty = agentGroups.length === 0 && !loading

  return (
    <div
      ref={containerRef}
      style={{ ...styles.page, ...(isDrawerPinned ? styles.pagePinned : {}) }}
      onPointerDown={edgeSwipe.onPointerDown}
    >
      <ProjectDrawer
        projects={projects}
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

      <div
        style={styles.overlay}
        onClick={handleCloseDrawer}
        data-visible={drawerOpen && !isDrawerPinned ? '1' : '0'}
      />

      <div style={styles.mainArea}>
        <div style={styles.topbar}>
          {!isDrawerPinned && (
            <button style={styles.hamburger} onClick={handleOpenDrawer} aria-label="打开项目抽屉">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={20} height={20}>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
          <ProjectSwitcher project={currentProject} onOpenDrawer={handleOpenDrawer} />
          <button style={styles.iconBtn} onClick={handleSearch} aria-label="搜索会话">
            <Search size={18} color="#595959" />
          </button>
          <button style={styles.iconBtn} onClick={handleNewSession} aria-label="新建会话">
            <Plus size={18} color="#595959" />
          </button>
        </div>

        <div style={styles.list}>
          {showEmpty && (
            <div style={styles.empty}>
              <MessageSquarePlus size={40} color="#b2b2b2" strokeWidth={1.2} />
              <span style={styles.emptyText}>暂无会话</span>
            </div>
          )}
          {agentGroups.map((group) => (
            <SessionGroup
              key={group.agentId}
              agentId={group.agentId}
              agentName={group.agentName}
              sessions={group.sessions}
              onLongPress={handleLongPress}
            />
          ))}
        </div>
      </div>

      <ProjectCreateSheet
        open={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
        onCreated={handleCreatedProject}
      />

      <ActionSheet
        open={!!actionSession}
        title={actionSession?.sessionTitle || actionSession?.agentName || '会话操作'}
        items={actionItems}
        onClose={() => setActionSession(null)}
      />

      <RenameDialog
        open={!!renameTarget}
        initialTitle={renameTarget?.sessionTitle || renameTarget?.agentName || ''}
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除会话"
        message="删除后不可恢复,确定要删除该会话吗?"
        confirmText="删除"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    width: '100%',
    background: '#ededed',
    position: 'relative',
    overflow: 'hidden',
  },
  pagePinned: {},
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    opacity: 0,
    pointerEvents: 'none',
    transition: 'opacity .3s',
    zIndex: 200,
  },
  mainArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
    minWidth: 0,
    background: '#ededed',
    transition: 'margin-left .3s cubic-bezier(0.32, 0.72, 0, 1)',
  },
  topbar: {
    padding: '8px 12px',
    background: '#f7f7f7',
    borderBottom: '0.5px solid #e0e0e0',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 50,
    paddingTop: 'calc(8px + var(--safe-top))',
  },
  hamburger: {
    width: 34,
    height: 34,
    borderRadius: 6,
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    border: 'none',
    flexShrink: 0,
    color: '#595959',
    transition: 'background .15s',
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 6,
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#595959',
    border: 'none',
    flexShrink: 0,
    transition: 'background .15s',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    background: '#ededed',
    padding: 0,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60%',
  },
  emptyText: {
    color: '#b2b2b2',
    fontSize: 14,
    marginTop: 12,
  },
}
