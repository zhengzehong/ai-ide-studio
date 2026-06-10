import { useNavigate } from 'react-router-dom'
import { Bot } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { WidgetSessionItem } from '@desktop/stores/widget.store'
import { mobileSessionIndicator } from '../utils/session-indicator'

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}分钟前`
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}小时前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function SessionCard({ session }: { session: WidgetSessionItem }) {
  const navigate = useNavigate()
  const indicator = mobileSessionIndicator(session)

  return (
    <div
      style={{ ...styles.card, ...(session.unread ? styles.unread : {}) }}
      onClick={() => navigate(`/chat/${session.sessionId}`)}
    >
      <div style={styles.row}>
        <div style={styles.titleArea}>
          <span style={styles.title}>{session.sessionTitle || session.agentName}</span>
        </div>
        <span style={styles.time}>{formatTime(session.lastMessageAt || session.startedAt)}</span>
      </div>

      <div style={styles.row}>
        <div style={styles.meta}>
          <span
            style={{
              ...styles.statusDot,
              background: indicator.color,
              animation: indicator.pulse ? 'mobile-session-running-pulse 1s ease-in-out infinite' : undefined,
              boxShadow: indicator.pulse ? '0 0 0 4px rgba(16, 185, 129, 0.12)' : undefined,
            }}
            title={indicator.title}
          />
          <span style={styles.statusText}>{indicator.label}</span>
          <span style={styles.agentTag}>
            <Bot size={11} style={{ marginRight: 3 }} />
            {session.agentName}
          </span>
        </div>
      </div>

      {session.projectName && (
        <span style={styles.project}>{session.projectName}</span>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    padding: '14px 16px',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    cursor: 'pointer',
    transition: 'background .15s',
  },
  unread: {
    background: '#fafaff',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  titleArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  time: {
    fontSize: 12,
    color: 'var(--text-muted)',
    flexShrink: 0,
    marginLeft: 8,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusText: {
    fontSize: 12,
    color: 'var(--text-secondary)',
  },
  agentTag: {
    fontSize: 11,
    color: 'var(--primary)',
    background: 'var(--primary-bg)',
    padding: '1px 6px',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
  },
  project: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 2,
    display: 'block',
  },
}
