import type { CSSProperties } from 'react'
import { formatRelativeTime } from '../../utils/task-time'

export interface PreviewCardData {
  previewId: string
  title: string
  target: 'pc' | 'app'
  taskId?: string | null
  createdAt: string
}

interface Props {
  preview: PreviewCardData
  onOpen: (previewId: string) => void
}

export default function PreviewCard({ preview, onOpen }: Props) {
  const isPc = preview.target === 'pc'
  return (
    <button style={styles.card} onClick={() => onOpen(preview.previewId)}>
      <div style={styles.top}>
        <span style={styles.icon}>{isPc ? '🖥' : '📱'}</span>
        <span style={styles.title}>{preview.title}</span>
        <span style={{ ...styles.target, ...(isPc ? styles.targetPc : styles.targetApp) }}>
          {isPc ? 'PC' : 'APP'}
        </span>
      </div>
      <div style={styles.meta}>
        {preview.taskId && (
          <>
            <span style={styles.link}>🔗 关联任务</span>
            <span style={styles.dot}> · </span>
          </>
        )}
        <span>{formatRelativeTime(preview.createdAt)}</span>
      </div>
      <div style={styles.action}>点击查看 →</div>
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    display: 'block',
    width: '100%',
    marginTop: 8,
    padding: '11px 12px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-light)',
    borderLeft: '3px solid var(--primary)',
    borderRadius: 10,
    boxShadow: '0 1px 2px rgba(0,0,0,.04)',
    cursor: 'pointer',
    textAlign: 'left',
  },
  top: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  icon: {
    fontSize: 14,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  target: {
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 3,
    flexShrink: 0,
  },
  targetApp: {
    color: 'var(--success)',
    background: 'rgba(16,185,129,.12)',
  },
  targetPc: {
    color: '#8b5cf6',
    background: 'rgba(139,92,246,.12)',
  },
  meta: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginBottom: 6,
    lineHeight: 1.4,
  },
  link: {
    color: 'var(--primary)',
  },
  dot: {
    color: 'var(--text-muted)',
  },
  action: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    fontSize: 12,
    color: 'var(--primary)',
    fontWeight: 500,
  },
}
