import { agentStore } from '../store/agents.js'
import { inspirationCandidateStore, type InspirationCandidateRow, type InspirationNoteRow } from '../store/inspiration-notes.js'
import { taskStore } from '../store/tasks.js'

export interface InspirationCandidateData {
  id: string
  noteId: string
  analysisRevision: number
  sortOrder: number
  title: string
  descriptionMarkdown: string
  suggestedAgentId: string | null
  suggestedAgentName: string | null
  agentReason: string
  taskId: string | null
  taskStatus: string | null
  executionSessionId: string | null
}

export interface InspirationNoteData {
  id: string
  projectId: string
  title: string
  titleMode: InspirationNoteRow['title_mode']
  sourceMarkdown: string
  attachments: unknown[]
  status: string
  analysisRevision: number
  summary: string
  bodyMarkdown: string
  questions: string[]
  lastError: string | null
  createdAt: string
  updatedAt: string
  organizedAt: string | null
  candidates: InspirationCandidateData[]
}

export function buildInspirationNoteData(row: InspirationNoteRow): InspirationNoteData {
  const hasCommittedAnalysis = row.status === 'ready' || row.status === 'needs_input'
  const candidates = hasCommittedAnalysis
    ? inspirationCandidateStore.listCurrent(row.id, row.analysis_revision).map(buildCandidateData)
    : []
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    titleMode: row.title_mode,
    sourceMarkdown: row.source_markdown,
    attachments: parseArray(row.attachments_json),
    status: row.status,
    analysisRevision: row.analysis_revision,
    summary: hasCommittedAnalysis ? row.summary : '',
    bodyMarkdown: hasCommittedAnalysis ? row.body_markdown : '',
    questions: hasCommittedAnalysis
      ? parseArray(row.questions_json).filter((item): item is string => typeof item === 'string')
      : [],
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    organizedAt: row.organized_at,
    candidates,
  }
}

function buildCandidateData(row: InspirationCandidateRow): InspirationCandidateData {
  const task = row.task_id ? taskStore.get(row.task_id) : undefined
  const agent = row.suggested_agent_id ? agentStore.get(row.suggested_agent_id) : undefined
  return {
    id: row.id,
    noteId: row.note_id,
    analysisRevision: row.analysis_revision,
    sortOrder: row.sort_order,
    title: row.title,
    descriptionMarkdown: row.description_markdown,
    suggestedAgentId: row.suggested_agent_id,
    suggestedAgentName: agent?.name ?? null,
    agentReason: row.agent_reason,
    taskId: row.task_id,
    taskStatus: task?.status ?? null,
    executionSessionId: row.execution_session_id,
  }
}

function parseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
