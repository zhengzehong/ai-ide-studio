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

export interface TeamConversationIndicatorInput extends TeamConversationRunningState {
  unread?: boolean
}

/**
 * 线的绿点/未读点判定：已归档线既不亮绿也不标未读——归档约定是"不再参与团队运行与未读提醒"，
 * 与徽标口径（总数含归档线、在跑/未读计数不含归档线）保持一致，避免归档瞬间误亮绿。
 * 服务端团队活动快照（activity）优先，缺失时回退实时信号与线自身字段。
 */
export function resolveTeamConversationIndicators(
  conversation: TeamConversationIndicatorInput,
  activity: { running?: boolean; unread?: boolean } | undefined,
  runningSessionIds: SessionIndicatorStateMap,
  sessionActivityStates: Record<string, 'running' | 'idle' | undefined> = {},
): { running: boolean; unread: boolean } {
  if (conversation.status && conversation.status !== 'active') return { running: false, unread: false }
  return {
    running: activity?.running ?? isTeamConversationRunning(conversation, runningSessionIds, sessionActivityStates),
    unread: activity?.unread ?? conversation.unread ?? false,
  }
}
