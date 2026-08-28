import { useEffect, type CSSProperties } from 'react'
import { Activity, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  useMobileActivityStore,
  type MobileActivityGroup,
  type MobileActivitySession,
} from '../stores/activity.store'
import { useAppStore } from '../stores/app.store'
import { useSessionStore } from '../stores/session.store'
import { AgentAvatar, ListRow, ProjectChip, formatRelativeTime, groupStyles } from '../components/session-list/list-kit'

interface ActivityProjectSyncDeps {
  setCurrentProject: (projectId: string) => void
  fetchAgents: (projectId: string) => Promise<void>
  fetchSessions: (projectId: string) => Promise<void>
}

export async function syncActivityProject(projectId: string | null, deps: ActivityProjectSyncDeps): Promise<void> {
  if (!projectId) return
  deps.setCurrentProject(projectId)
  await deps.fetchAgents(projectId)
  await deps.fetchSessions(projectId)
}

export function ActivityPage() {
  const navigate = useNavigate()
  const groups = useMobileActivityStore((state) => state.groups)
  const loading = useMobileActivityStore((state) => state.loading)
  const loaded = useMobileActivityStore((state) => state.loaded)
  const error = useMobileActivityStore((state) => state.error)
  const load = useMobileActivityStore((state) => state.load)
  const markRead = useMobileActivityStore((state) => state.markRead)
  const setCurrentProject = useAppStore((state) => state.setCurrentProject)
  const fetchAgents = useAppStore((state) => state.fetchAgents)
  const fetchSessions = useSessionStore((state) => state.fetchSessions)
  const sessionCount = groups.reduce((total, group) => total + group.sessions.length, 0)

  useEffect(() => {
    if (!loaded) void load()
  }, [load, loaded])

  const openSession = (group: MobileActivityGroup, session: MobileActivitySession): void => {
    void syncActivityProject(group.projectId, { setCurrentProject, fetchAgents, fetchSessions })
    if (session.unread) void markRead(session.sessionId)
    navigate(`/chat/${session.sessionId}`, { state: { returnTo: '/activity' } })
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.heading}>
          <h1 style={styles.title}>动态</h1>
          <div style={styles.subtitle}>{sessionCount > 0 ? `${sessionCount} 个会话需要关注` : '运行中和未读会话'}</div>
        </div>
        <button type="button" className="pressable" style={styles.iconButton} onClick={() => { void load() }} aria-label="刷新动态">
          <RefreshCw size={18} />
        </button>
      </header>

      {error && (
        <button type="button" style={styles.error} onClick={() => { void load() }}>
          <AlertCircle size={16} />
          <span>{error}</span>
          <strong>重试</strong>
        </button>
      )}

      <main style={styles.list}>
        {loading && groups.length === 0 ? (
          <div style={styles.empty}><Loader2 size={22} className="spin" />正在同步...</div>
        ) : groups.length === 0 ? (
          <div style={styles.empty}>
            <Activity size={42} color="var(--text-muted)" strokeWidth={1.3} />
            <strong style={styles.emptyTitle}>暂无动态</strong>
            <span>运行中或有新回复的会话会显示在这里</span>
          </div>
        ) : groups.map((group) => (
          <ActivityGroup key={group.groupId} group={group} onOpen={openSession} />
        ))}
      </main>
    </div>
  )
}

export function ActivityGroup({ group, onOpen }: { group: MobileActivityGroup; onOpen: (group: MobileActivityGroup, session: MobileActivitySession) => void }) {
  const project = useAppStore((state) => state.projects.find((p) => p.id === group.projectId))

  return (
    <section className="group-block" style={groupStyles.group} data-agent-id={group.agentId}>
      <div style={{ ...groupStyles.head, ...groupStyles.headPlain }}>
        <AgentAvatar agentId={group.agentId} name={group.agentName} />
        <div style={groupStyles.info}>
          <div style={groupStyles.name}>{group.agentName}</div>
          <div style={groupStyles.sub}>{group.sessions.length} 个会话</div>
        </div>
        <ProjectChip
          name={project?.name ?? group.projectName ?? '未归属项目'}
          icon={project?.icon}
          color={project?.color}
        />
      </div>
      {group.sessions.map((session) => {
        const isRunning = !!session.running
        return (
          <ListRow
            key={session.sessionId}
            title={session.sessionTitle || '未命名会话'}
            strong={session.unread}
            time={formatRelativeTime(session.activityAt)}
            label={isRunning ? '执行中' : '有新回复'}
            labelColor={isRunning ? 'var(--success)' : 'var(--primary)'}
            pulse={isRunning}
            detail={session.taskTitle || session.stage || '会话有新动态'}
            onClick={() => onOpen(group, session)}
          />
        )
      })}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  header: {
    padding: 'calc(14px + var(--safe-top)) 16px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heading: { minWidth: 0 },
  title: { margin: 0, color: 'var(--text-primary)', fontSize: 21, lineHeight: 1.25, fontWeight: 700 },
  subtitle: { marginTop: 2, color: 'var(--text-muted)', fontSize: 12 },
  iconButton: {
    width: 34,
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    background: 'var(--bg-card)',
    color: 'var(--text-secondary)',
    flexShrink: 0,
  },
  error: {
    margin: '0 10px 4px',
    padding: '9px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--error-bg)',
    color: 'var(--error)',
    fontSize: 12,
    textAlign: 'left',
  },
  list: { flex: 1, overflowY: 'auto', padding: '4px 0 20px' },
  empty: {
    height: '62%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    color: 'var(--text-muted)',
    fontSize: 13,
  },
  emptyTitle: { color: 'var(--text-secondary)', fontSize: 15 },
}
