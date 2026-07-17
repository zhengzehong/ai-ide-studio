import type { ProjectSessionStatsData } from '../../stores/project-session-stats.store'

interface ProjectActivityBadgesProps {
  stats?: ProjectSessionStatsData
  compact?: boolean
}

export function ProjectActivityBadges({ stats, compact = false }: ProjectActivityBadgesProps) {
  if (!stats || (stats.runningCount === 0 && stats.unreadCount === 0)) return null

  return (
    <span className={`project-activity-badges${compact ? ' compact' : ''}`}>
      {stats.runningCount > 0 && (
        <span className="project-activity-stat running" title={`运行中会话：${stats.runningCount}`}>
          <span className="project-activity-dot" aria-hidden="true" />
          {formatCount(stats.runningCount)}
        </span>
      )}
      {stats.unreadCount > 0 && (
        <span className="project-activity-stat unread" title={`未读会话：${stats.unreadCount}`}>
          <span className="project-activity-dot" aria-hidden="true" />
          {formatCount(stats.unreadCount)}
        </span>
      )}
    </span>
  )
}

function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}
