import { useMemo } from 'react'
import { useSessionDockStore, type SessionDockItem } from '../../stores/session-dock.store'
import { useProjectSessionStatsStore, type ProjectSessionStatsData } from '../../stores/project-session-stats.store'

/**
 * 会话坞 → 团队条目投影（对齐移动端 projectTeamPins 的口径）：
 * 坞里那条其实是团队线的 master session，展示与点击都应按"团队线"理解——
 * 名称用团队名、标题用线标题、运行/未读用线级状态（成员在跑也算），点击仍按 sessionId 深链，
 * 由 Workspace 的 session→线反查落到团队线视图。
 * 已归档线不投影（坞仍保留该行，但退回普通会话展示）。
 */
export function projectTeamDockItems(
  items: SessionDockItem[],
  statsByProjectId: Record<string, ProjectSessionStatsData>,
): SessionDockItem[] {
  if (!items.some((item) => item.teamConversationId)) return items
  return items.map((item) => {
    if (!item.teamId || !item.teamConversationId || item.teamConversationStatus !== 'active') return item
    const activity = statsByProjectId[item.projectId]?.teams
      ?.find((team) => team.teamId === item.teamId)
      ?.conversations.find((conversation) => conversation.conversationId === item.teamConversationId)
    return {
      ...item,
      agentId: item.teamId,
      agentName: item.teamName ?? item.agentName,
      sessionTitle: item.teamConversationTitle ?? item.sessionTitle,
      activityState: activity ? (activity.running ? 'running' as const : 'idle' as const) : item.activityState,
      unread: activity ? activity.unread : item.unread,
      lastActivityAt: activity?.lastMessageAt ?? item.lastActivityAt,
    }
  })
}

/** 坞的全部消费方（坞抽屉、全局助理导轨计数）共用同一份投影，避免两处口径漂移。 */
export function useProjectedSessionDockItems(): SessionDockItem[] {
  const items = useSessionDockStore((state) => state.items)
  const statsByProjectId = useProjectSessionStatsStore((state) => state.statsByProjectId)
  return useMemo(() => projectTeamDockItems(items, statsByProjectId), [items, statsByProjectId])
}
