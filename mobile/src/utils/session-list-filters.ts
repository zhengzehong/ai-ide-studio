import type { MobileSessionItem } from '../stores/session.store'

export type MobileSessionStatusFilter = 'all' | 'running' | 'unread' | 'closed'
export type MobileSessionSortMode = 'recent' | 'started'

export interface MobileSessionListFilters {
  agentId: string | null
  status: MobileSessionStatusFilter
  sort: MobileSessionSortMode
}

export function filterAndSortMobileSessions(
  sessions: MobileSessionItem[],
  filters: MobileSessionListFilters,
): MobileSessionItem[] {
  return sessions
    .filter((session) => matchesAgent(session, filters.agentId))
    .filter((session) => matchesStatus(session, filters.status))
    .slice()
    .sort((a, b) => activityTime(b, filters.sort) - activityTime(a, filters.sort))
}

function matchesAgent(session: MobileSessionItem, agentId: string | null): boolean {
  return !agentId || session.agentId === agentId
}

function matchesStatus(session: MobileSessionItem, status: MobileSessionStatusFilter): boolean {
  if (status === 'running') return session.activityState === 'running'
  if (status === 'unread') return session.unread
  if (status === 'closed') return session.status !== 'active'
  return true
}

function activityTime(session: MobileSessionItem, sort: MobileSessionSortMode): number {
  if (sort === 'started') return toTime(session.startedAt)
  return toTime(session.lastMessageAt) || toTime(session.updatedAt) || toTime(session.startedAt)
}

function toTime(value: string | null): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}
