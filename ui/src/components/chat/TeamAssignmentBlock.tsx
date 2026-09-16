import { ChevronDown, ChevronRight, ClipboardList, Send } from 'lucide-react'
import { useId, useState } from 'react'
import type { TeamAssignmentInfo } from '../../stores/session-events'

const DIRECTED_BADGE: Record<NonNullable<TeamAssignmentInfo['badge']>, { label: string; className: string }> = {
  queued: { label: '排队中 · 等待空闲', className: 'is-queued' },
  running: { label: '执行中', className: 'is-running' },
  done: { label: '已完成', className: 'is-done' },
}

export function TeamAssignmentBlock({ assignment }: { assignment: TeamAssignmentInfo }) {
  // 定向块默认展开（用户自己发的那句话应当直接可见）；派发块保持折叠的既有行为。
  const [open, setOpen] = useState(assignment.directed === true)
  const contentId = useId()
  const badge = assignment.directed && assignment.badge ? DIRECTED_BADGE[assignment.badge] : undefined
  return (
    <div className="conversation-team-assignment">
      <button type="button" className="conversation-team-assignment-header" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={contentId}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {assignment.directed ? <Send size={13} /> : <ClipboardList size={13} />}
        <span>{assignment.directed ? `你 → ${assignment.targetName || '成员'}` : `${assignment.fromName} 安排的任务`}</span>
        {badge && <span className={`directed-badge ${badge.className}`}>{badge.label}</span>}
        {assignment.taskId && <small>{assignment.taskId}</small>}
      </button>
      <div id={contentId} className={`conversation-team-assignment-content${open ? ' is-open' : ''}`}>
        {assignment.content}
      </div>
      {assignment.directed && (
        <div className="conversation-team-assignment-footnote">定向消息绕过 Master：Master 计划不会自动更新（预期行为）</div>
      )}
    </div>
  )
}
