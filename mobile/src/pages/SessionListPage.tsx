import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Bot, Clock3, MessageSquarePlus, RefreshCw } from 'lucide-react'
import { useSessionStore } from '../stores/session.store'
import { useAppStore } from '../stores/app.store'
import SessionCard from '../components/SessionCard'
import ProjectSwitcher from '../components/ProjectSwitcher'
import FilterSelectSheet from '../components/FilterSelectSheet'
import {
  filterAndSortMobileSessions,
  type MobileSessionSortMode,
  type MobileSessionStatusFilter,
} from '../utils/session-list-filters'

const STATUS_OPTIONS: Array<{ value: MobileSessionStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'unread', label: '未读' },
  { value: 'closed', label: '已关闭' },
]

const SORT_OPTIONS: Array<{ value: MobileSessionSortMode; label: string }> = [
  { value: 'recent', label: '最近活动' },
  { value: 'started', label: '创建时间' },
]

export default function SessionListPage() {
  const { sessions, loading, filterAgent, setFilterAgent, fetchSessions } = useSessionStore()
  const { projects, currentProjectId, setCurrentProject } = useAppStore()
  const [statusFilter, setStatusFilter] = useState<MobileSessionStatusFilter>('all')
  const [sortMode, setSortMode] = useState<MobileSessionSortMode>('recent')

  useEffect(() => {
    fetchSessions(currentProjectId)
  }, [currentProjectId, fetchSessions])

  const agentOptions = useMemo(() => {
    const map = new Map<string, string>()
    sessions.forEach((session) => map.set(session.agentId, session.agentName))
    const nameCounts = new Map<string, number>()
    map.forEach((name) => nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1))
    return [
      { value: '', label: '全部 Agent' },
      ...[...map.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
        .map(([id, name]) => ({
          value: id,
          label: (nameCounts.get(name) ?? 0) > 1 ? `${name} · ${id.slice(-4)}` : name,
        })),
    ]
  }, [sessions])

  useEffect(() => {
    if (filterAgent && !agentOptions.some((option) => option.value === filterAgent)) {
      setFilterAgent(null)
    }
  }, [agentOptions, filterAgent, setFilterAgent])

  const filtered = useMemo(() => filterAndSortMobileSessions(sessions, {
    agentId: filterAgent,
    status: statusFilter,
    sort: sortMode,
  }), [sessions, filterAgent, statusFilter, sortMode])

  const handleProjectChange = (id: string | null) => {
    setCurrentProject(id)
    setFilterAgent(null)
    fetchSessions(id)
  }

  const handleRefresh = () => fetchSessions(currentProjectId)

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.pickerRow}>
          <ProjectSwitcher
            projects={projects}
            currentId={currentProjectId}
            onChange={handleProjectChange}
          />
          <FilterSelectSheet
            icon={<Bot size={16} color="var(--primary)" />}
            title="筛选 Agent"
            value={filterAgent ?? ''}
            options={agentOptions}
            onChange={(value) => setFilterAgent(value || null)}
          />
          <button style={styles.iconBtn} onClick={handleRefresh}>
            <RefreshCw size={18} color="var(--text-secondary)" className={loading ? 'spin' : ''} />
          </button>
        </div>

        <div style={styles.filterRow}>
          <div style={styles.segmented}>
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                style={{ ...styles.segmentBtn, ...(statusFilter === option.value ? styles.segmentBtnActive : {}) }}
                onClick={() => setStatusFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <FilterSelectSheet
            compact
            icon={<Clock3 size={15} color="var(--primary)" />}
            title="排序方式"
            value={sortMode}
            options={SORT_OPTIONS}
            onChange={(value) => setSortMode(value as MobileSessionSortMode)}
          />
        </div>
      </div>

      <div style={styles.list}>
        {filtered.length === 0 && !loading && (
          <div style={styles.empty}>
            <MessageSquarePlus size={40} color="var(--text-muted)" strokeWidth={1.2} />
            <span style={styles.emptyText}>暂无会话</span>
          </div>
        )}
        {filtered.map((session) => (
          <SessionCard key={session.id} session={session} />
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
    flexDirection: 'column',
    gap: 10,
    padding: '12px 12px 10px',
    paddingTop: 'calc(12px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  pickerRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 36px',
    alignItems: 'center',
    gap: 8,
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  segmented: {
    flex: 1,
    minWidth: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    padding: 2,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-input)',
  },
  segmentBtn: {
    height: 30,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  },
  segmentBtnActive: {
    background: 'var(--bg-card)',
    color: 'var(--primary)',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
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
  emptyText: {
    color: 'var(--text-muted)',
    fontSize: 14,
    marginTop: 12,
  },
}
