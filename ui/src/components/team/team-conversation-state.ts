import type { SessionIndicatorStateMap } from '../../utils/session-indicators'

/**
 * 置顶线优先排序：命中共用会话坞（global_session_dock，键=master session）的线排前面，
 * 其余保持传入顺序（服务端已按 updated_at DESC 返回），排序稳定不抖动。
 */
export function sortTeamConversations<T extends { master_session_id: string }>(
  conversations: T[],
  pinnedSessionIds: ReadonlySet<string>,
): T[] {
  if (pinnedSessionIds.size === 0) return conversations
  return [...conversations].sort((left, right) =>
    Number(pinnedSessionIds.has(right.master_session_id)) - Number(pinnedSessionIds.has(left.master_session_id)))
}

export type TeamLineTargetDecision<T> = { kind: 'wait' } | { kind: 'select'; line: T } | { kind: 'fallback' }

/**
 * 深链反查结果的消费判定（Workspace `?sessionId=` → 团队线）。
 * - 非 active（已被归档/删除，或反查时还是 active 但对象已陈旧）→ 不消费，走普通会话兜底；
 * - 团队已在列表里 → 显式进该团队线视图；
 * - 团队列表还在加载 → 等下一轮（否则会被"团队不存在"的兜底 effect 立刻清掉）；
 * - 列表加载完仍找不到（团队刚归档）→ 兜底普通会话，别把深链卡死。
 */
export function resolveTeamLineTarget<T extends { team_id: string; status?: string }>(
  line: T | null,
  teamIds: ReadonlySet<string>,
  teamsLoading: boolean,
): TeamLineTargetDecision<T> {
  if (!line || line.status !== 'active') return { kind: 'fallback' }
  if (teamIds.has(line.team_id)) return { kind: 'select', line }
  if (teamsLoading) return { kind: 'wait' }
  return { kind: 'fallback' }
}

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
