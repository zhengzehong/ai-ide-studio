import { Archive, BookOpen, ChevronDown, RefreshCw, Search } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReadingStore } from '@desktop/stores/reading.store'
import type { ReadingItem } from '@desktop/types/reading'
import { MobileReadingCard } from '../components/reading/MobileReadingCard'
import { ReadingProjectSheet } from '../components/reading/ReadingProjectSheet'

export default function ReadingListPage() {
  const navigate = useNavigate()
  const items = useReadingStore((state) => state.items)
  const projectCounts = useReadingStore((state) => state.projectCounts)
  const loading = useReadingStore((state) => state.loading)
  const error = useReadingStore((state) => state.error)
  const load = useReadingStore((state) => state.load)
  const updateStatus = useReadingStore((state) => state.updateStatus)
  const [archived, setArchived] = useState(false)
  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined)
  const [projectSheetOpen, setProjectSheetOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load({ status: archived ? 'archived' : 'active', query, projectId })
    }, query ? 180 : 0)
    return () => window.clearTimeout(timer)
  }, [archived, load, projectId, query])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load({ status: archived ? 'archived' : 'active', query, projectId }, { silent: true })
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [archived, load, projectId, query])

  const openItem = (item: ReadingItem): void => {
    if (item.status === 'unread') void updateStatus(item.id, 'read')
    navigate(`/reading/${item.id}`)
  }

  const selectedProject = projectCounts.find((option) => option.projectId === projectId)
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.titleRow}>
          <h1 style={styles.title}>{archived ? '已归档' : '阅读'}</h1>
          <button type="button" className="pressable" style={styles.iconButton} onClick={() => setArchived((value) => !value)} aria-label={archived ? '返回阅读' : '查看已归档'}>
            <Archive size={19} />
          </button>
          <button type="button" className="pressable" style={styles.iconButton} onClick={() => void load({ status: archived ? 'archived' : 'active', query, projectId })} aria-label="刷新阅读列表">
            <RefreshCw size={18} />
          </button>
        </div>
        <div style={styles.filterRow}>
          <label style={styles.search}>
            <Search size={15} color="var(--text-muted)" />
            <input aria-label="搜索阅读内容" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、摘要或来源会话" style={styles.searchInput} />
          </label>
          <button type="button" className="pressable" style={styles.projectButton} onClick={() => setProjectSheetOpen(true)}>
            <span style={{ ...styles.projectDot, background: selectedProject?.projectColor || 'var(--text-muted)' }} />
            <span style={styles.projectLabel}>{projectId === undefined ? '全部' : selectedProject?.projectName || '未归类'}</span>
            <ChevronDown size={13} />
          </button>
        </div>
      </header>

      <main style={styles.list}>
        {loading && items.length === 0 && <EmptyState text="正在加载阅读列表" />}
        {!loading && error && <EmptyState text={error} error />}
        {!loading && !error && items.length === 0 && <EmptyState text={archived ? '还没有归档内容' : '没有待读内容'} />}
        {items.map((item) => (
          <MobileReadingCard
            key={item.id}
            item={item}
            archived={archived}
            onOpen={openItem}
            onStatus={(entry) => void updateStatus(entry.id, archived ? 'read' : 'archived')}
          />
        ))}
      </main>
      <ReadingProjectSheet open={projectSheetOpen} value={projectId} options={projectCounts} onSelect={setProjectId} onClose={() => setProjectSheetOpen(false)} />
    </div>
  )
}

function EmptyState({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <div style={{ ...styles.empty, ...(error ? styles.emptyError : {}) }} role="status">
      <BookOpen size={40} strokeWidth={1.3} />
      <strong>{text}</strong>
      {!error && <span>Agent 生成的长文会出现在这里</span>}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  header: { flexShrink: 0, padding: 'calc(12px + var(--safe-top)) 14px 11px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' },
  titleRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 },
  title: { flex: 1, margin: 0, fontSize: 22, color: 'var(--text-primary)' },
  iconButton: { width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'var(--bg-input)', color: 'var(--text-secondary)' },
  filterRow: { display: 'flex', alignItems: 'center', gap: 8 },
  search: { minWidth: 0, flex: 1, height: 38, display: 'flex', alignItems: 'center', gap: 7, padding: '0 11px', borderRadius: 'var(--radius)', background: 'var(--bg-input)' },
  searchInput: { minWidth: 0, flex: 1, border: 0, outline: 0, background: 'transparent', color: 'var(--text-primary)', fontSize: 12 },
  projectButton: { maxWidth: 112, height: 38, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRadius: 'var(--radius)', background: 'var(--bg-input)', color: 'var(--text-secondary)', fontSize: 12 },
  projectDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  projectLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  list: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 12px 24px' },
  empty: { minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', textAlign: 'center', fontSize: 12 },
  emptyError: { color: 'var(--error)' },
}
