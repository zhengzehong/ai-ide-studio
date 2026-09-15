export interface TeamConversationActivity {
  conversationId: string
  running: boolean
  unread: boolean
  lastMessageAt: string | null
  sessionIds: string[]
}

export interface TeamActivitySummary {
  teamId: string
  projectId: string
  running: boolean
  unread: boolean
  conversations: TeamConversationActivity[]
  /**
   * 线级计数（纯增字段，2026-09-15 团队条目计数对齐普通会话）。
   * 布尔字段保留：旧客户端与团队聊天内会话列表的四态点仍读 running/unread。
   * 旧服务端不返回三个计数，消费方必须用 `?? (布尔 ? 1 : 0)` 回退。
   */
  runningCount?: number
  unreadCount?: number
  /** 该团队全部非 deleted 会话线数（含已归档），对齐团队聊天列表可见线数。 */
  total?: number
}
