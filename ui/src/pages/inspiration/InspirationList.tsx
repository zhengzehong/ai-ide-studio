import { Pencil, Plus, Search } from 'lucide-react'
import type { InspirationNote } from '../../stores/inspiration.store'

interface InspirationListProps {
  notes: InspirationNote[]
  selectedId: string | null
  query: string
  onQueryChange: (query: string) => void
  onSelect: (noteId: string) => void
  onEdit: (noteId: string) => void
  onCreate: () => void
}

const statusLabels: Record<InspirationNote['status'], string> = {
  draft: '待整理',
  queued: '排队中',
  processing: '整理中',
  ready: '已整理',
  needs_input: '需要确认',
  failed: '整理失败',
}

export function InspirationList({
  notes,
  selectedId,
  query,
  onQueryChange,
  onSelect,
  onEdit,
  onCreate,
}: InspirationListProps) {
  const normalized = query.trim().toLowerCase()
  const visible = normalized
    ? notes.filter((note) => `${note.title} ${note.sourceMarkdown} ${note.summary}`.toLowerCase().includes(normalized))
    : notes

  return (
    <aside className="inspiration-list-pane">
      <div className="inspiration-list-tools">
        <label className="inspiration-search">
          <Search size={14} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索原文或 AI 结论" />
        </label>
        <button type="button" className="inspiration-primary" onClick={onCreate}><Plus size={15} />记录</button>
      </div>
      <div className="inspiration-list-scroll">
        <div className="inspiration-day-label">全部灵感 · {visible.length}</div>
        {visible.map((note) => (
          <article key={note.id} className={`inspiration-row${selectedId === note.id ? ' is-active' : ''}`}>
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
            <button type="button" className="inspiration-icon-button" onClick={() => onEdit(note.id)} title="编辑原文" aria-label="编辑原文"><Pencil size={14} /></button>
          </article>
        ))}
        {visible.length === 0 && <div className="inspiration-empty-list">暂无匹配的灵感</div>}
      </div>
    </aside>
  )
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
