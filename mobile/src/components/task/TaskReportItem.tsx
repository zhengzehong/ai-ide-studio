import { type CSSProperties } from 'react'
import { AlertCircle, CheckCircle2, Flag, GitBranch, MessageSquare, Send, Trash2 } from 'lucide-react'
import type { TaskEventItem } from '../../stores/task-detail.store'
import { parseEventPayload, getReportPreview, getEventStage, getEventStatusChange } from '../../stores/task-detail.store'
import { formatRelativeTime } from '../../utils/task-time'

export type ReportFilterMode = 'agent' | 'all'

interface Props {
  event: TaskEventItem
  unread: boolean
  onClick: (event: TaskEventItem) => void
}

interface EventMeta {
  icon: typeof AlertCircle
  label: string
  color: string
}

export function getEventMeta(type: string): EventMeta | null {
  switch (type) {
    case 'milestone':
      return { icon: Flag, label: '里程碑', color: 'var(--info)' }
    case 'input_requested':
      return { icon: AlertCircle, label: '需要确认', color: 'var(--warning)' }
    case 'marked_done':
      return { icon: CheckCircle2, label: '完成', color: 'var(--success)' }
    default:
      return null
  }
}

function getAllEventMeta(type: string): EventMeta {
  switch (type) {
    case 'milestone':
      return { icon: Flag, label: '里程碑', color: 'var(--info)' }
    case 'input_requested':
      return { icon: AlertCircle, label: '需要确认', color: 'var(--warning)' }
    case 'marked_done':
      return { icon: CheckCircle2, label: '完成', color: 'var(--success)' }
    case 'created':
      return { icon: GitBranch, label: '创建', color: 'var(--text-muted)' }
    case 'assigned':
    case 'assigned_agent':
      return { icon: Send, label: '指派', color: 'var(--text-muted)' }
    case 'session_linked':
      return { icon: MessageSquare, label: '会话关联', color: 'var(--text-muted)' }
    case 'deleted':
      return { icon: Trash2, label: '删除', color: 'var(--error)' }
    case 'replied':
      return { icon: MessageSquare, label: '回复', color: 'var(--text-muted)' }
    case 'status_changed':
    case 'manual_status_change':
    case 'updated':
    case 'stage_updated':
    case 'agent_status_changed':
    default:
      return { icon: GitBranch, label: '状态变更', color: 'var(--text-muted)' }
  }
}

function buildSummary(event: TaskEventItem): string {
  const payload = parseEventPayload(event.payload_json)
  const preview = getReportPreview(payload)
  if (preview) return preview
  const stage = getEventStage(payload)
  if (stage) return stage
  const change = getEventStatusChange(payload)
  if (change) {
    const parts: string[] = []
    if (change.from) parts.push(change.from)
    if (change.to) parts.push(`→ ${change.to}`)
    if (parts.length === 0) return '状态已更新'
    return parts.join(' ')
  }
  if (event.type === 'created') return '任务已创建'
  if (event.type === 'session_linked') return '已关联会话'
  if (event.type === 'replied') return '人工已回复,继续执行'
  if (event.type === 'deleted') return '任务已删除'
  return '任务状态已更新'
}

export default function TaskReportItem({ event, unread, onClick }: Props) {
  const meta = getAllEventMeta(event.type)
  const Icon = meta.icon
  const summary = buildSummary(event)

  return (
    <button style={styles.item} onClick={() => onClick(event)}>
      {unread && <span style={styles.unreadDot} />}
      <div style={styles.iconWrap}>
        <Icon size={14} color={meta.color} />
      </div>
      <div style={styles.body}>
        <div style={styles.headerRow}>
          <span style={{ ...styles.label, color: meta.color }}>{meta.label}</span>
          <span style={styles.time}>{formatRelativeTime(event.created_at)}</span>
        </div>
        <div style={styles.summary}>{summary}</div>
      </div>
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  item: {
    display: 'flex',
    gap: 10,
    padding: '10px 12px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 6,
    textAlign: 'left',
    width: '100%',
    position: 'relative',
  },
  unreadDot: {
    position: 'absolute',
    left: 4,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--error)',
  },
  iconWrap: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    width: 20,
    flexShrink: 0,
    paddingTop: 2,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
  },
  time: {
    fontSize: 11,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  summary: {
    fontSize: 13,
    color: 'var(--text-primary)',
    lineHeight: 1.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}
