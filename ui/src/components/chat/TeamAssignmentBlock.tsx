import { ChevronDown, ChevronRight, ClipboardList } from 'lucide-react'
import { useId, useState } from 'react'
import type { TeamAssignmentInfo } from '../../stores/session-events'

export function TeamAssignmentBlock({ assignment }: { assignment: TeamAssignmentInfo }) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  return (
    <div className="conversation-team-assignment">
      <button type="button" className="conversation-team-assignment-header" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={contentId}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <ClipboardList size={13} />
        <span>{assignment.fromName} 安排的任务</span>
        {assignment.taskId && <small>{assignment.taskId}</small>}
      </button>
      <div id={contentId} className={`conversation-team-assignment-content${open ? ' is-open' : ''}`}>
        {assignment.content}
      </div>
    </div>
  )
}
