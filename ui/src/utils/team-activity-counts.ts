import type { TeamActivitySummary } from '../../../src/shared/team-activity'

export interface TeamActivityCounts {
  running: number
  unread: number
  total: number
}

/**
 * 团队条目三选一计数 + 旧服务端回退链：
 * 新服务端直接给 runningCount/unreadCount/total；旧服务端只有布尔与 conversations，
 * 回退为 `布尔 ? 1 : 0` 与线数组长度，保证任一新旧组合都不出现空徽标。
 */
export function resolveTeamActivityCounts(
  summary?: Pick<TeamActivitySummary, 'running' | 'unread' | 'runningCount' | 'unreadCount' | 'total' | 'conversations'> | null,
): TeamActivityCounts {
  if (!summary) return { running: 0, unread: 0, total: 0 }
  return {
    running: summary.runningCount ?? (summary.running ? 1 : 0),
    unread: summary.unreadCount ?? (summary.unread ? 1 : 0),
    total: summary.total ?? summary.conversations.length,
  }
}
