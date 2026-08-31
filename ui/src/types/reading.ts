export type ReadingFormat = 'md' | 'html' | 'url'
export type ReadingStatus = 'unread' | 'read' | 'archived'
export type ReadingListStatus = 'active' | 'archived'

export interface ReadingItem {
  id: string
  projectId: string | null
  projectName: string | null
  projectColor: string | null
  sessionId: string | null
  sessionTitle: string | null
  agentId: string | null
  agentName: string | null
  agentIcon: string | null
  title: string
  summary: string
  format: ReadingFormat
  status: ReadingStatus
  createdAt: string
  updatedAt: string
  readAt: string | null
  archivedAt: string | null
  contentUrl: string | null
  externalUrl: string | null
}

export interface ReadingProjectCount {
  projectId: string | null
  projectName?: string | null
  projectColor?: string | null
  count: number
}

export interface ReadingListResult {
  items: ReadingItem[]
  unreadCount: number
  projectCounts: ReadingProjectCount[]
}

export interface ReadingListFilter {
  status?: ReadingListStatus
  projectId?: string | null
  query?: string
  limit?: number
  offset?: number
}
