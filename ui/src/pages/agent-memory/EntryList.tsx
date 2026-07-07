import { useMemo, useState } from 'react'
import { ConfirmDialog, ModalOverlay } from '../../components/ModalDialog'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import type { AgentMemoryEntrySummary } from '../../stores/agent-memory.store'

const PAGE_SIZE = 8
const INJECT_FULL_LIMIT = 3

interface EntryListProps {
  entries: AgentMemoryEntrySummary[]
  pinnedLimit: number
  pinnedCount: number
  injectFullLimit: number
  injectFullCount: number
  loading: boolean
  saving: boolean
  allTags: string[]
  dimensionName: string
  expandedContent: Record<string, string>
  onCreate: () => void
  onEdit: (entry: AgentMemoryEntrySummary) => void
  onDelete: (entry: AgentMemoryEntrySummary) => Promise<void>
  onTogglePinned: (entry: AgentMemoryEntrySummary) => Promise<void>
  onToggleInjectFull: (entry: AgentMemoryEntrySummary, downgradeOldest: boolean | null) => Promise<void>
  onExpand: (entry: AgentMemoryEntrySummary) => void
}

export function EntryList({
  entries,
  pinnedLimit,
  pinnedCount,
  injectFullLimit,
  injectFullCount,
  loading,
  saving,
  allTags,
  dimensionName,
  expandedContent,
  onCreate,
  onEdit,
  onDelete,
  onTogglePinned,
  onToggleInjectFull,
  onExpand,
}: EntryListProps) {
  const [keywordInput, setKeywordInput] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [onlyPinned, setOnlyPinned] = useState(false)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AgentMemoryEntrySummary | null>(null)
  const [injectFullTarget, setInjectFullTarget] = useState<AgentMemoryEntrySummary | null>(null)

  const keywords = useMemo(
    () => keywordInput.trim().split(/\s+/).filter(Boolean),
    [keywordInput],
  )

  const filtered = useMemo(() => {
    return entries
      .filter((e) => (onlyPinned ? e.pinned : true))
      .filter((e) => (tagFilter ? e.tags.includes(tagFilter) : true))
      .filter((e) => {
        if (keywords.length === 0) return true
        return keywords.some(
          (k) => e.title.includes(k) || e.preview.includes(k) || e.tags.some((t) => t.includes(k)),
        )
      })
  }, [entries, onlyPinned, tagFilter, keywords])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageList = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const handleExpand = (e: AgentMemoryEntrySummary) => {
    if (expandedId === e.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(e.id)
    if (!expandedContent[e.id]) {
      onExpand(e)
    }
  }

  const handleToggleInjectFull = (entry: AgentMemoryEntrySummary) => {
    if (entry.inject_full) {
      onToggleInjectFull(entry, null)
      return
    }
    if (injectFullCount >= injectFullLimit) {
      setInjectFullTarget(entry)
      return
    }
    onToggleInjectFull(entry, null)
  }

  const oldestInjectFull = useMemo(() => {
    if (!injectFullTarget) return null
    const candidates = entries
      .filter((e) => e.inject_full && e.id !== injectFullTarget.id)
      .sort((a, b) => a.use_count - b.use_count || (a.last_used_at ?? '').localeCompare(b.last_used_at ?? ''))
    return candidates[0] ?? null
  }, [injectFullTarget, entries])

  return (
    <main className="am-col">
      <div className="am-header">
        <div>
          <div className="am-eyebrow">{dimensionName}</div>
          <h2>条目{onlyPinned ? ' (只看置顶)' : ''}</h2>
        </div>
        <button type="button" className="am-icon-btn" title="新建条目" onClick={onCreate} disabled={saving}>+</button>
      </div>
      <div className="am-search">
        <input
          type="text"
          placeholder="多关键词用空格分隔,OR 匹配"
          value={keywordInput}
          onChange={(e) => { setKeywordInput(e.target.value); setPage(1) }}
        />
        <div className="am-filters">
          <select value={tagFilter} onChange={(e) => { setTagFilter(e.target.value); setPage(1) }}>
            <option value="">全部标签</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            type="button"
            className={`am-btn${onlyPinned ? ' am-btn-primary' : ''}`}
            onClick={() => { setOnlyPinned((v) => !v); setPage(1) }}
          >
            {onlyPinned ? '✓ 只看置顶' : '只看置顶'}
          </button>
        </div>
      </div>
      <div className="am-list">
        {loading && filtered.length === 0 ? (
          <div className="am-empty">加载中…</div>
        ) : pageList.length === 0 ? (
          <div className="am-empty">无匹配条目</div>
        ) : (
          pageList.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              expanded={expandedId === e.id}
              expandedContent={expandedId === e.id ? (expandedContent[e.id] ?? null) : null}
              saving={saving}
              onExpand={() => handleExpand(e)}
              onEdit={() => onEdit(e)}
              onDelete={() => setDeleting(e)}
              onTogglePinned={() => onTogglePinned(e)}
              onToggleInjectFull={() => handleToggleInjectFull(e)}
            />
          ))
        )}
      </div>
      <div className="am-pager">
        <span>共 {filtered.length} 条 · 全文 {injectFullCount}/{injectFullLimit} · 置顶 {pinnedCount}/{pinnedLimit}</span>
        <span>
          <button type="button" className="am-btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
          <span>{currentPage} / {totalPages}</span>
          <button type="button" className="am-btn" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>下一页</button>
        </span>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="删除条目"
        message={deleting ? `确认删除条目"${deleting.title}"?` : ''}
        confirmLabel="删除"
        danger
        onConfirm={async () => {
          if (deleting) {
            await onDelete(deleting)
            setDeleting(null)
          }
        }}
        onCancel={() => setDeleting(null)}
      />
      <ModalOverlay
        open={injectFullTarget !== null}
        onClose={() => setInjectFullTarget(null)}
        title="全文注入上限 3 条,已满"
        width={420}
      >
        {injectFullTarget ? (
          <InjectFullConfirmBody
            targetTitle={injectFullTarget.title}
            oldestTitle={oldestInjectFull?.title ?? ''}
            onCancel={() => setInjectFullTarget(null)}
            onDowngrade={async () => {
              const target = injectFullTarget
              setInjectFullTarget(null)
              await onToggleInjectFull(target, true)
            }}
            onPinnedOnly={async () => {
              const target = injectFullTarget
              setInjectFullTarget(null)
              await onToggleInjectFull(target, false)
            }}
          />
        ) : null}
      </ModalOverlay>
    </main>
  )
}

interface InjectFullConfirmBodyProps {
  targetTitle: string
  oldestTitle: string
  onCancel: () => void
  onDowngrade: () => void
  onPinnedOnly: () => void
}

function InjectFullConfirmBody({ targetTitle, oldestTitle, onCancel, onDowngrade, onPinnedOnly }: InjectFullConfirmBodyProps) {
  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 16 }}>
        当前要把 <strong>&quot;{targetTitle}&quot;</strong> 设为全文注入,但全文注入上限 {INJECT_FULL_LIMIT} 条已满。
        最旧的全文条目是 <strong>&quot;{oldestTitle}&quot;</strong>。请选择:
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" className="am-btn am-btn-primary" onClick={onDowngrade}>
          降级旧条目 &quot;{oldestTitle}&quot; 为仅置顶,并开启当前全文注入
        </button>
        <button type="button" className="am-btn" onClick={onPinnedOnly}>
          改用仅置顶(本次不开全文注入)
        </button>
        <button type="button" className="am-btn" onClick={onCancel}>取消</button>
      </div>
    </>
  )
}

interface EntryCardProps {
  entry: AgentMemoryEntrySummary
  expanded: boolean
  expandedContent: string | null
  saving: boolean
  onExpand: () => void
  onEdit: () => void
  onDelete: () => void
  onTogglePinned: () => void
  onToggleInjectFull: () => void
}

function EntryCard({ entry, expanded, expandedContent, saving, onExpand, onEdit, onDelete, onTogglePinned, onToggleInjectFull }: EntryCardProps) {
  return (
    <div className="am-entry">
      <div className="am-entry-title" onClick={onExpand}>
        {entry.pinned ? <span className="am-entry-pin">置顶</span> : null}
        {entry.inject_full ? <span className="am-entry-pin am-entry-pin-full">全文</span> : null}
        {entry.title}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>
          {expanded ? '▾ 收起' : '▸ 查看全文'}
        </span>
      </div>
      {expanded ? (
        <div className="am-entry-full">
          {expandedContent === null ? (
            <span style={{ color: 'var(--text-3)' }}>加载中…</span>
          ) : (
            <MarkdownRenderer content={expandedContent} />
          )}
        </div>
      ) : (
        <div className="am-entry-preview">{entry.preview}</div>
      )}
      <div className="am-entry-meta">
        <span className="am-entry-tags">
          {entry.tags.map((t) => (
            <span key={t} className="am-tag">{t}</span>
          ))}
        </span>
        <span>使用 {entry.use_count} 次</span>
        {entry.last_used_at ? <span>最近 {entry.last_used_at.slice(0, 10)}</span> : null}
        {entry.matched_keywords && entry.matched_keywords.length > 0 ? (
          <span style={{ color: 'var(--blue)' }}>命中: {entry.matched_keywords.join(', ')}</span>
        ) : null}
      </div>
      <div className="am-entry-actions">
        <button type="button" className="am-btn" onClick={onEdit} disabled={saving}>编辑</button>
        <button type="button" className="am-btn" onClick={onTogglePinned} disabled={saving}>
          {entry.pinned ? '取消置顶' : '置顶'}
        </button>
        <button type="button" className="am-btn" onClick={onToggleInjectFull} disabled={saving}>
          {entry.inject_full ? '取消全文' : '全文注入'}
        </button>
        <button type="button" className="am-btn am-btn-danger" onClick={onDelete} disabled={saving}>删除</button>
      </div>
    </div>
  )
}
