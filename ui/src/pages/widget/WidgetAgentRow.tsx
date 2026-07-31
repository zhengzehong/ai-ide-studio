import { Bot, GitBranch } from 'lucide-react'
import { ICON_MAP, type IconName } from '../../components/agent-square/constants'
import type { WidgetAgentActivityItem, WidgetAgentActivityState } from '../../stores/widget.store'
import { formatTimeAgo } from './format'

const STATE_LABELS: Record<WidgetAgentActivityState, string> = {
  running: '正在执行',
  needs_input: '需要确认',
  idle: '已完成',
}

interface WidgetAgentRowProps {
  activity: WidgetAgentActivityItem
  onClick(): void
}

export function WidgetAgentRow({ activity, onClick }: WidgetAgentRowProps) {
  const Icon = activity.agentIcon && ICON_MAP[activity.agentIcon as IconName]
    ? ICON_MAP[activity.agentIcon as IconName]
    : Bot

  return (
    <li>
      <button className="widget-agent-row" data-state={activity.activityState} data-unread={activity.unreadCount > 0 || undefined} onClick={onClick}>
        <span className="widget-agent-node" aria-hidden="true"><Icon size={16} /><span className="widget-state-dot" /></span>
        <span className="widget-agent-title">
          <span className="widget-agent-name">{activity.agentName}</span>
          {activity.projectName && <span className="widget-agent-project">{activity.projectName}</span>}
        </span>
        <time className="widget-agent-time" dateTime={activity.activityAt}>{formatTimeAgo(activity.activityAt)}</time>
        <span className="widget-agent-detail">
          <span className="widget-state-label">{STATE_LABELS[activity.activityState]}</span>
          {activity.taskTitle && (
            <>
              <span className="widget-detail-divider">·</span>
              <span className="widget-linked-task"><GitBranch size={12} /><span>{activity.taskTitle}</span></span>
            </>
          )}
        </span>
      </button>
    </li>
  )
}
