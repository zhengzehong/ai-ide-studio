import { useNavigate } from 'react-router-dom'
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { MobileSessionItem } from '../stores/session.store'
import { mobileSessionIndicator } from '../utils/session-indicator'
import { triggerHaptic } from '../utils/haptic'
import { ListRow, formatRelativeTime } from './session-list/list-kit'

const LONG_PRESS_MS = 500
const MOVE_CANCEL_PX = 10

interface Props {
  session: MobileSessionItem
  onLongPress?: (session: MobileSessionItem) => void
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
  const label = isRunning ? '执行中' : session.unread ? '有新回复' : indicator.label
  const labelColor = isRunning
    ? 'var(--success)'
    : session.unread ? 'var(--primary)' : 'var(--text-muted)'

  return (
    <ListRow
      title={session.sessionTitle || session.agentName}
      strong={session.unread}
      time={formatRelativeTime(session.lastMessageAt || session.startedAt)}
      label={label}
      labelColor={labelColor}
      pulse={isRunning}
      onClick={handleClick}
      onPointerDown={onLongPress ? handlePointerDown : undefined}
      onPointerMove={onLongPress ? handlePointerMove : undefined}
      onPointerUp={onLongPress ? handlePointerUpOrCancel : undefined}
      onPointerCancel={onLongPress ? handlePointerUpOrCancel : undefined}
      onPointerLeave={onLongPress ? handlePointerUpOrCancel : undefined}
    />
  )
}
