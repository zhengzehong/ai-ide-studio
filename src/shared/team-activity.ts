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
}
