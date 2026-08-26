import { CheckCircle2, Circle, Pencil, Plus, Search } from 'lucide-react'
import type { InspirationNote } from '../../stores/inspiration.store'

export type InspirationFilter = 'active' | 'completed' | 'all'

interface InspirationListProps {
  notes: InspirationNote[]
  selectedId: string | null
  query: string
  filter: InspirationFilter
  completionBusyId: string | null
  onQueryChange: (query: string) => void
  onFilterChange: (filter: InspirationFilter) => void
  onSelect: (noteId: string) => void
  onEdit: (noteId: string) => void
  onSetCompleted: (noteId: string, completed: boolean) => void
  onCreate: () => void
}

const statusLabels: Record<InspirationNote['status'], string> = {
  draft: '待整理',
  queued: '排队中',
  processing: '整理中',
  ready: '方案已生成',
  needs_input: '需要确认',
  failed: '整理失败',
}

export function InspirationList({
  notes,
  selectedId,
  query,
  filter,
  completionBusyId,
  onQueryChange,
  onFilterChange,
  onSelect,
  onEdit,
  onSetCompleted,
  onCreate,
}: InspirationListProps) {
  const counts = {
    active: notes.filter((note) => !note.completedAt).length,
    completed: notes.filter((note) => !!note.completedAt).length,
    all: notes.length,
  }
  const normalized = query.trim().toLowerCase()
  const visible = notes.filter((note) => {
    const matchesFilter = filter === 'all' || (filter === 'completed' ? !!note.completedAt : !note.completedAt)
    const matchesQuery = !normalized
      || `${note.title} ${note.sourceMarkdown} ${note.summary}`.toLowerCase().includes(normalized)
    return matchesFilter && matchesQuery
  })

  return (
    <aside className="inspiration-list-pane">
      <div className="inspiration-list-tools">
        <label className="inspiration-search">
          <Search size={14} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索原文或 AI 结论" />
        </label>
        <button type="button" className="inspiration-primary" onClick={onCreate}><Plus size={15} />记录</button>
        <div className="inspiration-filter" role="tablist" aria-label="灵感筛选">
          {(['active', 'completed', 'all'] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={filter === item} className={filter === item ? 'is-active' : ''} onClick={() => onFilterChange(item)}>
              {filterLabel(item)} <span>{counts[item]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="inspiration-list-scroll">
        <div className="inspiration-day-label">{filterLabel(filter)} · {visible.length}</div>
        {visible.map((note) => (
          <article key={note.id} className={`inspiration-row${selectedId === note.id ? ' is-active' : ''}${note.completedAt ? ' is-completed' : ''}`}>
            <time>{formatTime(note.updatedAt)}</time>
            <button type="button" className="inspiration-row-body" onClick={() => onSelect(note.id)}>
              <strong title={note.title}>{note.title}</strong>
              <span className="inspiration-raw" title={note.sourceMarkdown}>{oneLine(note.sourceMarkdown)}</span>
              <span className="inspiration-summary">
                <b>AI</b>
                <span>{note.summary || fallbackSummary(note)}</span>
              </span>
              <span className={`inspiration-state is-${note.status}`}><i />{statusLabels[note.status]}</span>
            </button>
            <div className="inspiration-row-actions">
              <button
                type="button"
                className={`inspiration-completion-toggle${note.completedAt ? ' is-completed' : ''}`}
                disabled={completionBusyId === note.id || (!note.completedAt && (note.status === 'queued' || note.status === 'processing'))}
                onClick={() => onSetCompleted(note.id, !note.completedAt)}
                title={note.completedAt ? '重新打开' : '标记完成'}
                aria-label={note.completedAt ? '重新打开灵感' : '标记灵感完成'}
              >
                {note.completedAt ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                <span>{note.completedAt ? '已完成' : '完成'}</span>
              </button>
              <button type="button" className="inspiration-icon-button" onClick={() => onEdit(note.id)} title="编辑原文" aria-label="编辑原文"><Pencil size={14} /></button>
            </div>
          </article>
        ))}
        {visible.length === 0 && <div className="inspiration-empty-list">{normalized ? '暂无匹配的灵感' : filter === 'completed' ? '暂无已完成灵感' : '暂无进行中的灵感'}</div>}
      </div>
    </aside>
  )
}

function filterLabel(filter: InspirationFilter): string {
  if (filter === 'active') return '进行中'
  if (filter === 'completed') return '已完成'
  return '全部'
}

function fallbackSummary(note: InspirationNote): string {
  if (note.status === 'processing') return '正在理解原始记录并生成方案…'
  if (note.status === 'queued') return '等待项目灵感会话整理…'
  if (note.status === 'failed') return note.lastError || '整理失败，可重新尝试'
  return '尚未整理，原始记录已经保存'
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
