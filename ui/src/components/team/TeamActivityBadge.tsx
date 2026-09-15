import type { ReactElement } from 'react'
import { useProjectSessionStatsStore } from '../../stores/project-session-stats.store'
import { ActivityCountBadge } from '../session/ActivityCountBadge'
import { resolveTeamActivityCounts } from '../../utils/team-activity-counts'

/** 团队条目徽标：与普通会话同款三选一数字（在跑线数 / 未读线数 / 线总数），旧服务端走布尔回退。 */
export function TeamActivityBadge({ projectId, teamId }: { projectId: string; teamId: string }): ReactElement | null {
  const activity = useProjectSessionStatsStore(state => state.statsByProjectId[projectId]?.teams?.find(team => team.teamId === teamId))
  const counts = resolveTeamActivityCounts(activity)
  return (
    <ActivityCountBadge
      running={counts.running}
      unread={counts.unread}
      total={counts.total}
      titles={{ running: '运行中团队会话', unread: '未读团队会话', total: '团队会话总数' }}
    />
  )
}
