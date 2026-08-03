import { GitBranch } from 'lucide-react'
import type { WidgetSessionActivityItem } from '../../stores/widget.store'
import { formatTimeAgo } from './format'

interface WidgetSessionActivityRowProps {
  session: WidgetSessionActivityItem
  onClick(): void
}

function stateLabel(session: WidgetSessionActivityItem): string {
  if (session.attentionState === 'running') return '执行中'
  if (session.attentionState === 'unread') return '未读'
  return session.taskStatus === 'blocked' ? '已阻塞' : '待确认'
}

export function WidgetSessionActivityRow({ session, onClick }: WidgetSessionActivityRowProps) {
  return (
    <li>
      <button
        className="widget-session-activity-row"
        data-state={session.attentionState}
        type="button"
        onClick={onClick}
        title={`${stateLabel(session)} ${session.sessionTitle || '未命名会话'}${session.taskTitle ? ` - ${session.taskTitle}` : ''}`}
      >
        <span className="widget-session-state"><span className="widget-session-state-dot" />{stateLabel(session)}</span>
        <span className="widget-session-content">
          <span className="widget-session-title">{session.sessionTitle || '未命名会话'}</span>
          {session.taskTitle && (
            <>
              <span className="widget-session-separator">-</span>
              <span className="widget-session-task"><GitBranch size={11} /><span>{session.taskTitle}</span></span>
            </>
          )}
        </span>
        <time className="widget-session-time" dateTime={session.activityAt}>{formatTimeAgo(session.activityAt)}</time>
      </button>
    </li>
  )
}
