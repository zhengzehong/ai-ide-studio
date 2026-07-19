import type { MessageRow, SessionEventRow, SessionListRow } from '../store/sessions.js'
import type { TaskRow } from '../store/tasks.js'

export interface QueryPage<T> {
  items: T[]
  hasMore: boolean
  nextCursor: string | null
}

export interface TaskStepSummary {
  id: string
  title: string
  status: string
  assignee: string | null
  sessionId: string | null
  dependsOn: string[]
  currentStage: string | null
}

export interface TaskStepProgress {
  done: number
  total: number
}

export interface TaskListItem extends TaskRow {
  sessionId: string | null
  steps: TaskStepSummary[]
  stepProgress: TaskStepProgress
  latestReportPreview: string | null
  latestReportAt: string | null
  latestReportType: string | null
}

export interface TaskListQuery {
  projectId?: string
  status?: string
}

export interface SessionListQuery {
  projectId?: string
  agentId?: string
}

export interface SessionMessageQuery {
  sessionId: string
  limit?: number
  before?: string
  includeToolCalls?: boolean
  includeLatestToolCalls?: boolean
}

export interface SessionEventQuery {
  sessionId: string
  limit?: number
  afterSequence?: number
}

export interface QueryPort {
  listTasks(input: TaskListQuery): Promise<TaskListItem[]>
  listSessions(input: SessionListQuery): Promise<SessionListRow[]>
  listSessionMessages(input: SessionMessageQuery): Promise<QueryPage<MessageRow>>
  listSessionEvents(input: SessionEventQuery): Promise<QueryPage<SessionEventRow>>
}
