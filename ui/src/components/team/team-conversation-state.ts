import type { SessionIndicatorStateMap } from '../../utils/session-indicators'

export interface TeamConversationRunningState {
  master_session_id: string
  activity_state?: 'running' | 'idle' | null
}

export function isTeamConversationRunning(
  conversation: TeamConversationRunningState,
  runningSessionIds: SessionIndicatorStateMap,
  sessionActivityStates: Record<string, 'running' | 'idle' | undefined> = {},
): boolean {
  return Boolean(
    runningSessionIds[conversation.master_session_id]
      || sessionActivityStates[conversation.master_session_id] === 'running'
      || conversation.activity_state === 'running',
  )
}
