import { useMemo } from 'react'
import { useProjectSessionStatsStore, type ProjectSessionStatsData } from '../stores/project-session-stats.store'
import { useProjectStore } from '../stores/project.store'
import { useSessionStore, type SessionData } from '../stores/session.store'
import {
  summarizeSessionIndicators,
  type SessionIndicatorStateMap,
} from '../utils/session-indicators'
import { isSecretarySessionPurpose } from '../stores/secretary-session'

interface ResolveUnifiedProjectSessionStatsInput {
  backendStats: Record<string, ProjectSessionStatsData>
  activeProjectId: string | null
  sessions: SessionData[]
  runningSessionIds: SessionIndicatorStateMap
  unreadSessionIds: SessionIndicatorStateMap
}

export function resolveUnifiedProjectSessionStats({
  backendStats,
  activeProjectId,
  sessions,
  runningSessionIds,
  unreadSessionIds,
}: ResolveUnifiedProjectSessionStatsInput): Record<string, ProjectSessionStatsData> {
  if (!activeProjectId) return backendStats
  const activeSessions = sessions.filter((session) => (
    session.project_id === activeProjectId
    && session.purpose !== 'autonomy'
    && !isSecretarySessionPurpose(session.purpose)
  ))
  const summary = summarizeSessionIndicators(activeSessions, runningSessionIds, unreadSessionIds)
  return {
    ...backendStats,
    [activeProjectId]: {
      projectId: activeProjectId,
      runningCount: summary.running,
      unreadCount: summary.unread,
    },
  }
}

export function useUnifiedProjectSessionStats(): Record<string, ProjectSessionStatsData> {
  const backendStats = useProjectSessionStatsStore((state) => state.statsByProjectId)
  const activeProjectId = useProjectStore((state) => state.currentProjectId)
  const sessions = useSessionStore((state) => state.sessions)
  const runningSessionIds = useSessionStore((state) => state.runningSessionIds)
  const unreadSessionIds = useSessionStore((state) => state.unreadSessionIds)

  return useMemo(() => resolveUnifiedProjectSessionStats({
    backendStats,
    activeProjectId,
    sessions,
    runningSessionIds,
    unreadSessionIds,
  }), [activeProjectId, backendStats, runningSessionIds, sessions, unreadSessionIds])
}
