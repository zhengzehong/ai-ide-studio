import { useNavigate } from 'react-router-dom'
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

  const isRunning = session.activityState === 'running'
  const indicatorColor = isRunning ? '#07c160' : session.unread ? '#fa5151' : '#c8c8c8'
  const indicatorLabel = isRunning ? '执行中' : session.unread ? '有新回复' : indicator.label

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
      {session.unread && <span style={styles.unreadDot} />}
      <div style={styles.row}>
        <span style={{ ...styles.title, ...(session.unread ? styles.titleUnread : {}) }}>
          {session.sessionTitle || session.agentName}
        </span>
        <span style={styles.time}>{formatTime(session.lastMessageAt || session.startedAt)}</span>
      </div>
      <div style={styles.meta}>
        <span
          style={{
            ...styles.statusDot,
            background: indicatorColor,
            ...(isRunning ? styles.statusDotRunning : {}),
          }}
        />
        <span style={{ ...styles.statusText, color: isRunning ? '#07c160' : '#888' }}>
          {indicatorLabel}
        </span>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    padding: '11px 14px 11px 60px',
    borderTop: '0.5px solid #f0f0f0',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    position: 'relative',
    transition: 'background .15s',
    touchAction: 'pan-y',
  },
  unread: {},
  unreadDot: {
    position: 'absolute',
    left: 40,
    top: 17,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#fa5151',
    boxShadow: '0 0 0 3px #fff',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 400,
    color: '#191919',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  titleUnread: {
    fontWeight: 500,
  },
  time: {
    fontSize: 11,
    color: '#b2b2b2',
    flexShrink: 0,
    fontWeight: 400,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: '#888',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusDotRunning: {
    animation: 'mobile-status-running 1.5s infinite',
  },
  statusText: {
    fontSize: 12,
  },
}
