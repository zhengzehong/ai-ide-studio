import type { SessionIndicatorStateMap } from '../../utils/session-indicators'

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
  const gridSessionIds = conversation.grid_session_ids ?? []
  return Boolean(
    conversation.activity_state === 'running'
      || gridSessionIds.some((sessionId) => runningSessionIds[sessionId])
      || runningSessionIds[conversation.master_session_id]
      || sessionActivityStates[conversation.master_session_id] === 'running',
  )
}
