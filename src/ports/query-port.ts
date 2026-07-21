import type { MessageRow, SessionEventRow, SessionListRow } from '../store/sessions.js'
import type { TaskRow } from '../store/tasks.js'
import type { QueryPriority } from '../data-worker/protocol.js'

export interface QueryRequestOptions {
  priority?: QueryPriority
  deadlineMs?: number
}

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

export interface TaskListQuery extends QueryRequestOptions {
  projectId?: string
  status?: string
}

export interface SessionListQuery extends QueryRequestOptions {
  projectId?: string
  agentId?: string
  activePromptSessionIds?: string[]
}

export interface SessionMessageQuery extends QueryRequestOptions {
  sessionId: string
  limit?: number
  before?: string
  includeToolCalls?: boolean
  includeLatestToolCalls?: boolean
}

export interface SessionEventQuery extends QueryRequestOptions {
  sessionId: string
  limit?: number
  afterSequence?: number
}

export interface SessionRecoveryQuery extends QueryRequestOptions {
  sessionId: string
  limit?: number
}

export interface SessionRecoverySnapshot {
  sessionId: string
  latestSequence: number
  events: SessionEventRow[]
}

export interface QueryPort {
  listTasks(input: TaskListQuery): Promise<TaskListItem[]>
  listSessions(input: SessionListQuery): Promise<SessionListRow[]>
  listSessionMessages(input: SessionMessageQuery): Promise<QueryPage<MessageRow>>
  listSessionEvents(input: SessionEventQuery): Promise<QueryPage<SessionEventRow>>
  getSessionRecovery(input: SessionRecoveryQuery): Promise<SessionRecoverySnapshot>
}
