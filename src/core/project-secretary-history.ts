import { projectSecretaryStore } from '../store/project-secretaries.js'
import { secretaryRunStore, type SecretaryRunRow } from '../store/secretary-runs.js'
import { sessionStore } from '../store/sessions.js'

export interface SecretaryRunData {
  id: string
  eventType: string
  sourceId: string | null
  status: SecretaryRunRow['status']
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  elapsedMs: number | null
}

export function listSecretaryRuns(id: string, projectId: string, limit = 20): SecretaryRunData[] {
  requireSecretary(id, projectId)
  const boundedLimit = Math.min(50, Math.max(1, Math.floor(limit)))
  return secretaryRunStore.listRecent(id, boundedLimit).map(toRunData)
}

export function getSecretarySession(id: string, projectId: string, sessionId: string) {
  const secretary = requireSecretary(id, projectId)
  const expectedPurpose = sessionId === secretary.runtime_session_id
    ? 'secretary_runtime'
    : sessionId === secretary.chat_session_id
      ? 'secretary_chat'
      : null
  if (!expectedPurpose) throw new Error('会话不属于当前秘书')
  const session = sessionStore.get(sessionId)
  if (!session || session.project_id !== projectId || session.purpose !== expectedPurpose) {
    throw new Error('秘书会话不存在')
  }
  return session
}

function requireSecretary(id: string, projectId: string) {
  const secretary = projectSecretaryStore.get(id)
  if (!secretary || secretary.project_id !== projectId) throw new Error('秘书不存在或不属于当前项目')
  return secretary
}

function toRunData(row: SecretaryRunRow): SecretaryRunData {
  const startedAt = row.started_at ? Date.parse(row.started_at) : Number.NaN
  const finishedAt = row.finished_at ? Date.parse(row.finished_at) : Date.now()
  const elapsedMs = Number.isFinite(startedAt) && Number.isFinite(finishedAt)
    ? Math.max(0, finishedAt - startedAt)
    : null
  return {
    id: row.id,
    eventType: row.event_type,
    sourceId: row.source_id,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    elapsedMs,
  }
}
