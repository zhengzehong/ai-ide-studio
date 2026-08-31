import { Archive, RotateCcw } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ReadingItem } from '@desktop/types/reading'

interface MobileReadingCardProps {
  item: ReadingItem
  archived: boolean
  onOpen: (item: ReadingItem) => void
  onStatus: (item: ReadingItem) => void
}

export function MobileReadingCard({ item, archived, onOpen, onStatus }: MobileReadingCardProps) {
  const color = item.projectColor || 'var(--text-muted)'
  return (
    <article style={{ ...styles.card, ...(item.status === 'read' ? styles.read : {}) }}>
      <button type="button" className="pressable" style={styles.main} onClick={() => onOpen(item)}>
        <span style={{ ...styles.projectTag, color, background: item.projectColor ? `${item.projectColor}18` : 'var(--bg-input)' }}>
          <span style={{ ...styles.projectDot, background: color }} />
          {item.projectName || '未归类'}
        </span>
        <strong style={styles.title}>
          {item.status === 'unread' && <span aria-label="未读" style={styles.unreadDot} />}
          {item.title}
        </strong>
        {item.summary && <span style={styles.summary}>{item.summary}</span>}
        <span style={styles.meta}>
          <span style={styles.kind}>{formatLabel(item.format)}</span>
          <span>{item.agentName || '未知 Agent'}</span>
          <span>·</span>
          <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
        </span>
      </button>
      <button type="button" className="pressable" style={styles.action} onClick={() => onStatus(item)}>
        {archived ? <RotateCcw size={13} /> : <Archive size={13} />}
        {archived ? '恢复' : '归档'}
      </button>
    </article>
  )
}

function formatLabel(format: ReadingItem['format']): string {
  return format === 'html' ? 'HTML' : format === 'url' ? '链接' : 'MD'
}

function formatTime(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

const styles: Record<string, CSSProperties> = {
  card: { position: 'relative', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' },
  read: { opacity: 0.66 },
  main: { width: '100%', minHeight: 128, padding: '14px 14px 38px', border: 0, background: 'transparent', textAlign: 'left', color: 'inherit' },
  projectTag: { position: 'absolute', top: 12, right: 12, maxWidth: 100, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 600 },
  projectDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  title: { display: 'block', paddingRight: 84, color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.45 },
  unreadDot: { display: 'inline-block', width: 7, height: 7, marginRight: 6, borderRadius: '50%', background: 'var(--primary)', verticalAlign: 1 },
  summary: { display: '-webkit-box', marginTop: 7, paddingRight: 38, overflow: 'hidden', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.55 },
  meta: { position: 'absolute', left: 14, bottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 11 },
  kind: { padding: '1px 6px', borderRadius: 5, background: 'var(--bg-input)', color: 'var(--text-secondary)', fontSize: 10, fontWeight: 700 },
  action: { position: 'absolute', right: 10, bottom: 9, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 8, background: 'var(--bg-input)', color: 'var(--text-secondary)', fontSize: 11 },
}
