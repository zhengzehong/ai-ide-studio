import type { SessionIndicatorStateMap } from '../../utils/session-indicators'

export function teamConversationListNeedsRefresh(message: Record<string, unknown>): boolean {
  const data = message.data
  if (!data || typeof data !== 'object') return false
  const update = data as Record<string, unknown>
  return typeof update.conversationId === 'string' || update.reason === 'member.created' || update.reason === 'updated'
}

export interface TeamConversationRunningState {
  master_session_id: string
  status?: string
  activity_state?: 'running' | 'idle' | null
  /** 线内全部格子 session id（后端聚合，含成员格子）：任一格子 live running 即线 running。 */
  grid_session_ids?: string[] | null
}

export function isTeamConversationRunning(
  conversation: TeamConversationRunningState,
  runningSessionIds: SessionIndicatorStateMap,
  sessionActivityStates: Record<string, 'running' | 'idle' | undefined> = {},
): boolean {
  const gridSessionIds = [...new Set([conversation.master_session_id, ...(conversation.grid_session_ids ?? [])])]
  if (gridSessionIds.every(id => sessionActivityStates[id] === 'idle' && !runningSessionIds[id])) return false
  return Boolean(
    conversation.activity_state === 'running'
      || gridSessionIds.some((sessionId) => runningSessionIds[sessionId] || sessionActivityStates[sessionId] === 'running')
      || runningSessionIds[conversation.master_session_id]
      || sessionActivityStates[conversation.master_session_id] === 'running',
  )
}
