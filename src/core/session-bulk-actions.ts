import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { sessionManager } from './sessions.js'
import { sessionStore, type SessionListRow, type SessionRow } from '../store/sessions.js'
import type { SessionBulkAction, SessionBulkActionResultData } from '../types/ws-protocol.js'

export const MAX_SESSION_BULK_IDS = 200

export interface SessionBulkCandidate {
  id: string
  agent_id: string
  project_id: string | null
  is_primary: number | boolean
  status: string
  activity_state?: 'running' | 'idle'
  purpose: SessionRow['purpose'] | string
  deleted_at: string | null
}

export interface SessionBulkActionInput {
  action: SessionBulkAction
  agentId: string
  projectId: string
  sessionIds: string[]
}

const log = createChildLogger('session-bulk-actions')

export function normalizeSessionIds(ids: string[], max = MAX_SESSION_BULK_IDS): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const normalized = id.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
    if (unique.length >= max) break
  }
  return unique
}

export function canBatchDeleteSession(session: SessionBulkCandidate): boolean {
  return !session.is_primary
    && session.activity_state !== 'running'
    && !(session.activity_state === undefined && session.status === 'active')
    && session.purpose === 'conversation'
    && !session.deleted_at
}

export function batchDeleteSkipReason(session: SessionBulkCandidate): string | null {
  if (session.is_primary) return '主会话不可批量删除'
  if (session.activity_state === 'running' || (session.activity_state === undefined && session.status === 'active')) {
    return '运行中的会话不可批量删除'
  }
  if (session.purpose !== 'conversation') return '系统会话不可批量删除'
  if (session.deleted_at) return '会话已删除'
  return null
}

export function buildSessionBulkActionResult(
  action: SessionBulkAction,
  succeeded: string[],
  skipped: Array<{ sessionId: string; reason: string }>,
  lastReadAt?: string,
): SessionBulkActionResultData {
  return {
    action,
    succeeded,
    skipped,
    ...(lastReadAt ? { lastReadAt } : {}),
  }
}

export async function executeSessionBulkAction(
  input: SessionBulkActionInput,
  isPromptActive: (sessionId: string) => boolean = () => false,
): Promise<SessionBulkActionResultData> {
  if (!input.agentId.trim()) throw new Error('agentId 不能为空')
  if (!input.projectId.trim()) throw new Error('projectId 不能为空')
  const sessionIds = normalizeSessionIds(input.sessionIds)
  if (sessionIds.length === 0) throw new Error('至少选择一个会话')

  const candidates = new Map<string, SessionListRow>(
    sessionStore.listWithRuntimeState(input.agentId, input.projectId, isPromptActive).map((session) => [session.id, session]),
  )
  const skipped: Array<{ sessionId: string; reason: string }> = []
  const scoped: SessionListRow[] = []
  for (const sessionId of sessionIds) {
    const candidate = candidates.get(sessionId)
    if (!candidate) {
      skipped.push({ sessionId, reason: '会话不属于当前 Agent 或项目' })
      continue
    }
    if (candidate.purpose !== 'conversation') {
      skipped.push({ sessionId, reason: '系统会话不可批量操作' })
      continue
    }
    scoped.push(candidate)
  }

  if (input.action === 'markRead') return markSessionsRead(scoped, skipped)
  return deleteSessions(scoped, skipped)
}

function markSessionsRead(
  sessions: SessionListRow[],
  skipped: Array<{ sessionId: string; reason: string }>,
): SessionBulkActionResultData {
  const lastReadAt = new Date().toISOString()
  sessionStore.markReadMany(sessions.map((session) => session.id), lastReadAt)
  for (const session of sessions) {
    events.emit('session:changed', { sessionId: session.id, data: { last_read_at: lastReadAt } })
  }
  log.info({ count: sessions.length, skipped: skipped.length }, '批量标记会话已读完成')
  return buildSessionBulkActionResult('markRead', sessions.map((session) => session.id), skipped, lastReadAt)
}

async function deleteSessions(
  sessions: SessionListRow[],
  skipped: Array<{ sessionId: string; reason: string }>,
): Promise<SessionBulkActionResultData> {
  const succeeded: string[] = []
  for (const session of sessions) {
    const reason = batchDeleteSkipReason(session)
    if (reason) {
      skipped.push({ sessionId: session.id, reason })
      continue
    }
    try {
      await sessionManager.deleteSession(session.id)
      succeeded.push(session.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      skipped.push({ sessionId: session.id, reason: message })
      log.warn({ sessionId: session.id, agentId: session.agent_id, error: message }, '批量删除会话失败')
    }
  }
  log.info({ count: succeeded.length, skipped: skipped.length }, '批量删除会话完成')
  return buildSessionBulkActionResult('delete', succeeded, skipped)
}
