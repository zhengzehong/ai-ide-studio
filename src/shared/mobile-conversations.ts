export interface MobileTeamOwner {
  id: string
  name: string
  projectId: string
}

export interface MobileTeamConversation {
  id: string
  teamId: string
  projectId: string
  masterSessionId: string
  title: string
  status: string
  running: boolean
  unread: boolean
  lastMessageAt: string | null
  createdAt: string
  sessionIds: string[]
}

export interface MobileConversationCatalog {
  teams: MobileTeamOwner[]
  conversations: MobileTeamConversation[]
  hiddenAgentIds: string[]
  hiddenSessionIds: string[]
}
