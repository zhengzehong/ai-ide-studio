import type { ReactElement } from 'react'
import { useProjectSessionStatsStore } from '../../stores/project-session-stats.store'

export function TeamActivityBadge({ projectId, teamId }: { projectId: string; teamId: string }): ReactElement | null {
  const activity = useProjectSessionStatsStore(state => state.statsByProjectId[projectId]?.teams?.find(team => team.teamId === teamId))
  if (!activity?.running && !activity?.unread) return null
  return <span aria-label={activity.running ? '团队运行中' : '团队有未读'} title={activity.running ? '团队运行中' : '团队有未读'} style={{ width: 7, height: 7, flexShrink: 0, borderRadius: '50%', background: activity.running ? 'var(--green)' : 'var(--yellow)', animation: activity.running ? 'session-running-pulse 1s ease-in-out infinite' : undefined }} />
}
