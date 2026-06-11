import { useEffect, useMemo, type CSSProperties } from 'react'
import { RefreshCw, MessageSquarePlus } from 'lucide-react'
import { useSessionStore } from '../stores/session.store'
import { useAppStore } from '../stores/app.store'
import SessionCard from '../components/SessionCard'
import AgentFilterChips from '../components/AgentFilterChips'
import ProjectSwitcher from '../components/ProjectSwitcher'

export default function SessionListPage() {
  const { sessions, loading, filterAgent, setFilterAgent, fetchSessions } = useSessionStore()
  const { projects, currentProjectId, setCurrentProject } = useAppStore()

  useEffect(() => {
    fetchSessions(currentProjectId)
  }, [currentProjectId, fetchSessions])

  const filtered = useMemo(() => {
    let list = sessions
    if (filterAgent) list = list.filter((s) => s.agentId === filterAgent)
    return list
  }, [sessions, filterAgent])

  const uniqueAgents = useMemo(() => {
    const map = new Map<string, string>()
    sessions.forEach((s) => map.set(s.agentId, s.agentName))
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [sessions])

  const handleRefresh = () => fetchSessions(currentProjectId)

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <ProjectSwitcher
          projects={projects}
          currentId={currentProjectId}
          onChange={(id) => { setCurrentProject(id); fetchSessions(id) }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.iconBtn} onClick={handleRefresh}>
            <RefreshCw size={18} color="var(--text-secondary)" className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <AgentFilterChips agents={uniqueAgents} selected={filterAgent} onChange={setFilterAgent} />

      <div style={styles.list}>
        {filtered.length === 0 && !loading && (
          <div style={styles.empty}>
            <MessageSquarePlus size={40} color="var(--text-muted)" strokeWidth={1.2} />
            <span style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 12 }}>暂无会话</span>
          </div>
        )}
        {filtered.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
      </div>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    paddingTop: 'calc(12px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-input)',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60%',
  },
}
