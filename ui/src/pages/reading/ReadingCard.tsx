import { Archive, RotateCcw } from 'lucide-react'
import type { ReadingItem } from '../../types/reading'

interface ReadingCardProps {
  item: ReadingItem
  selected: boolean
  archived: boolean
  onOpen: (item: ReadingItem) => void
  onStatus: (item: ReadingItem) => void
}

export function ReadingCard({ item, selected, archived, onOpen, onStatus }: ReadingCardProps) {
  const projectName = item.projectName?.trim() || '未归类'
  const color = item.projectColor || 'var(--text-3)'
  return (
    <article className={`reading-card${selected ? ' reading-card--selected' : ''}${item.status === 'unread' ? ' reading-card--unread' : ' reading-card--read'}`}>
      <button className="reading-card-main" type="button" onClick={() => onOpen(item)}>
        <span className="reading-project-tag" style={{ color, background: `color-mix(in srgb, ${color} 10%, var(--bg-0))` }}>
          <span className="reading-project-dot" style={{ background: color }} />
          {projectName}
        </span>
        <strong className="reading-card-title">
          {item.status === 'unread' && <span className="reading-unread-dot" aria-label="未读" />}
          {item.title}
        </strong>
        {item.summary && <span className="reading-card-summary">{item.summary}</span>}
        <span className="reading-card-meta">
          <span className={`reading-kind reading-kind--${item.format}`}>{formatLabel(item.format)}</span>
          <span>{item.agentName || '未知 Agent'}</span>
          <span>·</span>
          <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
        </span>
      </button>
      <button className="reading-card-action" type="button" onClick={() => onStatus(item)}>
        {archived ? <RotateCcw size={13} /> : <Archive size={13} />}
        {archived ? '恢复' : '归档'}
      </button>
    </article>
  )
}

function formatLabel(format: ReadingItem['format']): string {
  if (format === 'html') return 'HTML'
  if (format === 'url') return '链接'
  return 'MD'
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
