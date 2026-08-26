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
        <div>
          <h1 style={styles.title}>动态</h1>
          <div style={styles.subtitle}>{sessionCount > 0 ? `${sessionCount} 个会话需要关注` : '运行中和未读会话'}</div>
        </div>
        <button type="button" style={styles.iconButton} onClick={() => { void load() }} aria-label="刷新动态">
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
            <Activity size={42} color="#b2b2b2" strokeWidth={1.3} />
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
  return (
    <section style={styles.group}>
      <div style={styles.groupHeader}>
        <span style={styles.avatar}>{group.agentName.trim().slice(0, 2) || '?'}</span>
        <div style={styles.groupHeading}>
          <strong style={styles.agentName}>{group.agentName}</strong>
          <span style={styles.projectName}>{group.projectName || '未归属项目'}</span>
        </div>
        <span style={styles.count}>{group.sessions.length}</span>
      </div>
      {group.sessions.map((session) => (
        <button key={session.sessionId} type="button" style={styles.session} onClick={() => onOpen(group, session)}>
          <span style={{ ...styles.stateBar, background: session.running ? '#07c160' : '#fa5151' }} />
          <span style={styles.sessionMain}>
            <span style={styles.sessionTitle}>{session.sessionTitle || '未命名会话'}</span>
            <span style={styles.sessionMeta}>{session.taskTitle || session.stage || '会话有新动态'}</span>
          </span>
          <span style={{ ...styles.state, color: session.running ? '#07c160' : '#fa5151' }}>
            {session.running ? '运行中' : '未读'}
          </span>
        </button>
      ))}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: '#ededed' },
  header: { padding: 'calc(12px + var(--safe-top)) 16px 11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f7f7f7', borderBottom: '0.5px solid #e0e0e0' },
  title: { margin: 0, color: '#191919', fontSize: 20, lineHeight: 1.25, fontWeight: 650 },
  subtitle: { marginTop: 3, color: '#999', fontSize: 11 },
  iconButton: { width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, color: '#595959' },
  error: { margin: 10, padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 7, borderRadius: 6, background: '#fff1f0', color: '#d4380d', fontSize: 12, textAlign: 'left' },
  list: { flex: 1, overflowY: 'auto', padding: '8px 0 20px' },
  empty: { height: '62%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, color: '#999', fontSize: 13 },
  emptyTitle: { color: '#555', fontSize: 15 },
  group: { marginBottom: 8, background: '#fff' },
  groupHeader: { minHeight: 54, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: '0.5px solid #f0f0f0' },
  avatar: { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 6, background: '#576b95', color: '#fff', fontSize: 12 },
  groupHeading: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' },
  agentName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#191919', fontSize: 14, fontWeight: 550 },
  projectName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1, color: '#999', fontSize: 11 },
  count: { minWidth: 20, height: 20, padding: '0 6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: '#f2f2f2', color: '#888', fontSize: 11 },
  session: { position: 'relative', width: '100%', minHeight: 64, padding: '10px 14px 10px 20px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', borderBottom: '0.5px solid #f4f4f4', background: '#fff' },
  stateBar: { position: 'absolute', left: 8, top: 13, bottom: 13, width: 3, borderRadius: 2 },
  sessionMain: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' },
  sessionTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#191919', fontSize: 14, fontWeight: 500 },
  sessionMeta: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4, color: '#888', fontSize: 11 },
  state: { flexShrink: 0, fontSize: 11, fontWeight: 500 },
}
