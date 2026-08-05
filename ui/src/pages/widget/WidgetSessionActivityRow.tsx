import type { WidgetSessionActivityItem } from '../../stores/widget.store'
import { formatCompactTimeAgo } from './format'

interface WidgetSessionActivityRowProps {
  session: WidgetSessionActivityItem
  onClick(): void
}

function stateLabel(session: WidgetSessionActivityItem): string {
  if (session.attentionState === 'running') return '执行中'
  return '未读'
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
              <span className="widget-session-task"><span>{session.taskTitle}</span></span>
            </>
          )}
        </span>
        <time className="widget-session-time" dateTime={session.activityAt}>{formatCompactTimeAgo(session.activityAt)}</time>
      </button>
    </li>
  )
}
