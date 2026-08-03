import { Bot } from 'lucide-react'
import { ICON_MAP, type IconName } from '../../components/agent-square/constants'
import type { WidgetAgentProjectActivityGroup, WidgetSessionActivityItem } from '../../stores/widget.store'
import { WidgetSessionActivityRow } from './WidgetSessionActivityRow'

interface WidgetAgentProjectGroupProps {
  group: WidgetAgentProjectActivityGroup
  onSessionClick(session: WidgetSessionActivityItem): void
}

export function WidgetAgentProjectGroup({ group, onSessionClick }: WidgetAgentProjectGroupProps) {
  const Icon = group.agentIcon && ICON_MAP[group.agentIcon as IconName]
    ? ICON_MAP[group.agentIcon as IconName]
    : Bot

  return (
    <li className="widget-agent-project-group">
      <header className="widget-agent-project-header">
        <span className="widget-agent-project-node" aria-hidden="true"><Icon size={15} /></span>
        <span className="widget-agent-project-identity">
          <span className="widget-agent-project-name">{group.agentName}</span>
          <span className="widget-project-name">{group.projectName || '未归属项目'}</span>
        </span>
        <span className="widget-group-session-count">{group.sessions.length} 个会话</span>
      </header>
      <ol className="widget-session-activity-list">
        {group.sessions.map((session) => (
          <WidgetSessionActivityRow
            key={session.sessionId}
            session={session}
            onClick={() => onSessionClick(session)}
          />
        ))}
      </ol>
    </li>
  )
}
