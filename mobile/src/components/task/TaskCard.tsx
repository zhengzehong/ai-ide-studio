import {
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { AlertCircle, MessageSquare } from 'lucide-react'
import type { TaskStatus } from '../../../../src/types/ws-protocol'
import { formatRelativeTime, formatDuration, diffMsFromNow } from '../../utils/task-time'
import { isTaskUnread, getUnreadCount } from '../../utils/task-unread'
import { triggerHaptic } from '../../utils/haptic'

const LONG_PRESS_MS = 500
const MOVE_CANCEL_PX = 10
const STALE_DAYS = 7
const DAY_MS = 86_400_000

const STATUS_COLORS = {
  running: 'var(--info)',
  completed: 'var(--success)',
  cancelled: 'var(--text-muted)',
  draft: 'var(--text-muted)',
}

export interface TaskCardItem {
  id: string
  title: string
  description?: string | null
  status: TaskStatus
  stage?: string | null
  created_at: string
  updated_at?: string | null
  assigned_agent_id?: string | null
  agent_name?: string | null
  project_id?: string | null
}

interface Props {
  task: TaskCardItem
  onLongPress?: (task: TaskCardItem) => void
  onClick?: (task: TaskCardItem) => void
}

type Handlers = {
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp?: () => void
  onPointerCancel?: () => void
  onPointerLeave?: () => void
}

export default function TaskCard({ task, onLongPress, onClick }: Props) {
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
      onLongPress(task)
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startPosRef.current || !timerRef.current) return
    const dx = event.clientX - startPosRef.current.x
    const dy = event.clientY - startPosRef.current.y
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) clearTimer()
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
    onClick?.(task)
  }

  const handlers: Handlers = onLongPress
    ? {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUpOrCancel,
        onPointerCancel: handlePointerUpOrCancel,
        onPointerLeave: handlePointerUpOrCancel,
      }
    : {}

  if (task.status === 'needs_input') {
    return <NeedsCard task={task} handlers={handlers} onClick={handleClick} />
  }
  if (task.status === 'running') {
    return <ExecutingCard task={task} handlers={handlers} onClick={handleClick} />
  }
  if (task.status === 'draft') {
    return <BacklogCard task={task} handlers={handlers} onClick={handleClick} />
  }
  return <HistoryCard task={task} handlers={handlers} onClick={handleClick} />
}

function NeedsCard({ task, handlers, onClick }: { task: TaskCardItem; handlers: Handlers; onClick: () => void }) {
  const waitMs = diffMsFromNow(task.updated_at || task.created_at)
  const preview = task.description || task.stage || ''
  const unread = isTaskUnread(task.id, task.updated_at || undefined)
  return (
    <div style={needsStyles.card} {...handlers} onClick={onClick}>
      <span style={needsStyles.bar} />
      <div style={needsStyles.body}>
        <div style={needsStyles.titleRow}>
          <span style={needsStyles.title}>{task.title}</span>
          <span style={needsStyles.waitTag}>等待{formatDuration(waitMs)}</span>
        </div>
        <div style={needsStyles.metaRow}>
          <AlertCircle size={12} color="var(--warning)" />
          <span style={needsStyles.agentName}>{task.agent_name || '未指派'}</span>
          <span style={needsStyles.dot}>·</span>
          <span style={needsStyles.statusLabel}>需要确认</span>
        </div>
        {preview && (
          <div style={needsStyles.previewRow}>
            <MessageSquare size={12} color="var(--text-muted)" />
            <span style={needsStyles.previewText}>{preview}</span>
          </div>
        )}
        {unread && (
          <div style={needsStyles.unreadRow}>
            <span style={needsStyles.unreadDot} />
            <span style={needsStyles.unreadText}>{getUnreadCount(task.id)} 条新汇报</span>
          </div>
        )}
      </div>
    </div>
  )
}

function ExecutingCard({ task, handlers, onClick }: { task: TaskCardItem; handlers: Handlers; onClick: () => void }) {
  const elapsedMs = diffMsFromNow(task.updated_at || task.created_at)
  const showElapsed = elapsedMs && elapsedMs >= 60_000
  return (
    <div style={normalStyles.card} {...handlers} onClick={onClick}>
      <div style={normalStyles.titleRow}>
        <span style={{ ...normalStyles.dot, background: STATUS_COLORS.running }} />
        <span style={normalStyles.title}>{task.title}</span>
        <span style={normalStyles.time}>{formatRelativeTime(task.updated_at || task.created_at)}</span>
      </div>
      <div style={normalStyles.metaRow}>
        <span style={normalStyles.agent}>{task.agent_name || '未指派'}</span>
        <span style={normalStyles.dotSep}>·</span>
        <span style={normalStyles.status}>行动中</span>
        {showElapsed && (
          <>
            <span style={normalStyles.dotSep}>·</span>
            <span style={normalStyles.elapsed}>已用 {formatDuration(elapsedMs)}</span>
          </>
        )}
      </div>
    </div>
  )
}

function BacklogCard({ task, handlers, onClick }: { task: TaskCardItem; handlers: Handlers; onClick: () => void }) {
  const staleDays = Math.floor(diffMsFromNow(task.created_at) / DAY_MS)
  const isStale = staleDays >= STALE_DAYS
  return (
    <div style={{ ...backlogStyles.card, ...(isStale ? backlogStyles.stale : {}) }} {...handlers} onClick={onClick}>
      <div style={backlogStyles.titleRow}>
        <span style={backlogStyles.dot} />
        <span style={backlogStyles.title}>{task.title}</span>
        <span style={backlogStyles.time}>{formatRelativeTime(task.created_at)}</span>
      </div>
      <div style={backlogStyles.metaRow}>
        <span style={backlogStyles.agent}>{task.assigned_agent_id ? task.agent_name || '已指派' : '未指派'}</span>
        <span style={backlogStyles.dotSep}>·</span>
        <span style={backlogStyles.status}>待办</span>
        {isStale && (
          <>
            <span style={backlogStyles.dotSep}>·</span>
            <span style={backlogStyles.staleTag}>⏰ 已搁置 {staleDays} 天</span>
          </>
        )}
      </div>
    </div>
  )
}

function HistoryCard({ task, handlers, onClick }: { task: TaskCardItem; handlers: Handlers; onClick: () => void }) {
  const isCompleted = task.status === 'completed'
  return (
    <div style={{ ...backlogStyles.card, opacity: 0.7 }} {...handlers} onClick={onClick}>
      <div style={backlogStyles.titleRow}>
        <span style={{ ...backlogStyles.dot, background: isCompleted ? STATUS_COLORS.completed : STATUS_COLORS.cancelled }} />
        <span style={backlogStyles.title}>{task.title}</span>
        <span style={backlogStyles.time}>{formatRelativeTime(task.updated_at || task.created_at)}</span>
      </div>
      <div style={backlogStyles.metaRow}>
        <span style={backlogStyles.agent}>{task.agent_name || '未指派'}</span>
        <span style={backlogStyles.dotSep}>·</span>
        <span style={backlogStyles.status}>{isCompleted ? '已完成' : '已取消'}</span>
      </div>
    </div>
  )
}

const cardBase: CSSProperties = {
  padding: '12px 14px',
  background: 'var(--bg-card)',
  borderRadius: 'var(--radius)',
  marginBottom: 8,
  border: '1px solid var(--border-light)',
  cursor: 'pointer',
  touchAction: 'pan-y',
}

const needsStyles: Record<string, CSSProperties> = {
  card: { ...cardBase, position: 'relative', display: 'flex', overflow: 'hidden' },
  bar: { width: 4, flexShrink: 0, background: 'var(--warning)' },
  body: { flex: 1, padding: '10px 14px', minWidth: 0 },
  titleRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: {
    flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  waitTag: {
    fontSize: 11, color: 'var(--warning)', background: 'rgba(245, 158, 11, .12)',
    padding: '2px 8px', borderRadius: 10, fontWeight: 600, flexShrink: 0,
  },
  metaRow: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' },
  agentName: { color: 'var(--text-secondary)' },
  dot: { color: 'var(--text-muted)' },
  statusLabel: { color: 'var(--warning)', fontWeight: 500 },
  previewRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, minWidth: 0 },
  previewText: {
    flex: 1, fontSize: 12, color: 'var(--text-muted)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  unreadRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 },
  unreadDot: { width: 6, height: 6, borderRadius: '50%', background: 'var(--error)', flexShrink: 0 },
  unreadText: { fontSize: 11, color: 'var(--error)', fontWeight: 500 },
}

const normalStyles: Record<string, CSSProperties> = {
  card: cardBase,
  titleRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: {
    flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  time: { fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 },
  metaRow: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' },
  agent: { color: 'var(--text-secondary)' },
  dotSep: { color: 'var(--text-muted)' },
  status: { color: 'var(--info)', fontWeight: 500 },
  elapsed: { color: 'var(--text-muted)' },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
}

const backlogStyles: Record<string, CSSProperties> = {
  card: cardBase,
  stale: { opacity: 0.7 },
  titleRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: {
    flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  time: { fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 },
  metaRow: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' },
  agent: { color: 'var(--text-muted)' },
  dotSep: { color: 'var(--text-muted)' },
  status: { color: 'var(--text-muted)' },
  staleTag: { color: 'var(--warning)', fontSize: 11 },
  dot: { width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS.draft, flexShrink: 0 },
}
