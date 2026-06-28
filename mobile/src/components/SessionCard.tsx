import { useNavigate } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { MobileSessionItem } from '../stores/session.store'
import { mobileSessionIndicator } from '../utils/session-indicator'
import { triggerHaptic } from '../utils/haptic'

const LONG_PRESS_MS = 500
const MOVE_CANCEL_PX = 10

interface Props {
  session: MobileSessionItem
  onLongPress?: (session: MobileSessionItem) => void
}

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

export default function SessionCard({ session, onLongPress }: Props) {
  const navigate = useNavigate()
  const indicator = mobileSessionIndicator(session)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const longPressFiredRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onLongPress) return
    longPressFiredRef.current = false
    startPosRef.current = { x: event.clientX, y: event.clientY }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      longPressFiredRef.current = true
      triggerHaptic()
      onLongPress(session)
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startPosRef.current || !timerRef.current) return
    const dx = event.clientX - startPosRef.current.x
    const dy = event.clientY - startPosRef.current.y
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
      clearTimer()
    }
  }

  const handlePointerUpOrCancel = () => {
    clearTimer()
    startPosRef.current = null
  }

  const handleClick = () => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false
      return
    }
    navigate(`/chat/${session.id}`)
  }

  return (
    <div
      style={{ ...styles.card, ...(session.unread ? styles.unread : {}) }}
      onPointerDown={onLongPress ? handlePointerDown : undefined}
      onPointerMove={onLongPress ? handlePointerMove : undefined}
      onPointerUp={onLongPress ? handlePointerUpOrCancel : undefined}
      onPointerCancel={onLongPress ? handlePointerUpOrCancel : undefined}
      onPointerLeave={onLongPress ? handlePointerUpOrCancel : undefined}
      onClick={handleClick}
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
    touchAction: 'pan-y',
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
