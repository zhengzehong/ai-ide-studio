import { Check, ChevronRight, FileText, MessageSquare as MessageSquareIcon, Plus, Pencil, Play } from 'lucide-react'
import type { TaskEventData } from '../../../stores/task.store'
import { TASK_EVENT_TYPE_META, eventReportMd, eventStage, formatRelativeTime } from './task-helpers'
import { STEP_COLORS } from './step-helpers'

function actionBtnStyle(): React.CSSProperties {
  return {
    flex: 'initial',
    border: '1px solid var(--border)',
    background: 'white',
    color: 'var(--text-2)',
    padding: '5px 10px',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  }
}

function primaryBtnStyle(disabled: boolean, bg: string = '#165dff'): React.CSSProperties {
  return {
    border: `1px solid ${bg}`,
    background: disabled ? 'var(--bg-2)' : bg,
    color: disabled ? 'var(--text-3)' : 'white',
    padding: '5px 14px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  }
}

interface DetailActionsProps {
  isCollab: boolean
  isTerminal: boolean
  isDraft: boolean
  isBacklog: boolean
  updating: boolean
  hasSessions: boolean
  onStart: () => void
  onMarkComplete: () => void
  onJumpToSession: () => void
  onAddStep?: () => void
  onEdit?: () => void
}

export function DetailActions(props: DetailActionsProps) {
  if (props.isTerminal) return null
  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      padding: '8px 12px',
      display: 'flex',
      gap: 5,
      flexShrink: 0,
      background: 'var(--bg-0)',
    }}>
      {props.isCollab && props.onAddStep && (
        <button type="button" onClick={props.onAddStep} style={actionBtnStyle()} title="加步骤">
          <Plus size={11} /> 加步骤
        </button>
      )}
      {props.onEdit && (
        <button type="button" onClick={props.onEdit} style={actionBtnStyle()} title="编辑">
          <Pencil size={11} /> 编辑
        </button>
      )}
      <div style={{ flex: 1 }} />
      {props.isCollab && props.isDraft && (
        <button type="button" onClick={props.onStart} disabled={props.updating} style={primaryBtnStyle(props.updating)}>
          <Play size={11} />
          {props.updating ? '处理中...' : '启动任务'}
        </button>
      )}
      {!props.isBacklog && !props.isCollab && (
        <button type="button" onClick={props.onMarkComplete} disabled={props.updating} style={primaryBtnStyle(props.updating, '#00b42a')}>
          <Check size={11} />
          {props.updating ? '处理中...' : '标记完成'}
        </button>
      )}
      {!props.isBacklog && props.hasSessions && (
        <button type="button" onClick={props.onJumpToSession} style={actionBtnStyle()} title="跳转到会话">
          <MessageSquareIcon size={11} />
          跳转
        </button>
      )}
    </div>
  )
}

interface LatestReportCardProps {
  event: TaskEventData
  onClick: () => void
}

export function LatestReportCard({ event, onClick }: LatestReportCardProps) {
  const meta = TASK_EVENT_TYPE_META[event.type] ?? { label: event.type, color: 'var(--text-3)', bg: 'var(--bg-2)' }
  const stage = eventStage(event)
  const md = eventReportMd(event)
  const isBlocked = event.type === 'input_requested' || (event.type === 'step_report' && /blocked/i.test(md))
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '7px 9px',
        borderRadius: 4,
        border: 'none',
        borderLeft: `2px solid ${isBlocked ? STEP_COLORS.blocked : meta.color}`,
        background: isBlocked ? '#fff1f0' : 'var(--bg-1)',
        cursor: 'pointer',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: isBlocked ? STEP_COLORS.blocked : meta.color, marginBottom: 2 }}>
        {meta.label} · {formatRelativeTime(event.created_at)}
      </div>
      {stage && <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}>→ {stage}</div>}
      <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {md}
      </div>
    </button>
  )
}

export function EmptyReports() {
  return (
    <div style={{
      padding: '24px 12px',
      textAlign: 'center',
      fontSize: 12,
      color: 'var(--text-3)',
      background: 'var(--bg-1)',
      borderRadius: 8,
      border: '1px dashed var(--border)',
    }}>
      <FileText size={20} style={{ opacity: 0.3, marginBottom: 6 }} />
      <div>Agent 还没有汇报</div>
    </div>
  )
}

export { ChevronRight }
