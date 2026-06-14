import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

export interface AgentSessionMessageRow {
  id: string
  project_id: string | null
  source_agent_id: string
  source_session_id: string
  target_agent_id: string
  target_session_id: string
  content: string
  related_info_json: string
  need_reply: number
  reply_satisfied_at: string | null
  reply_reminder_sent_at: string | null
  reply_reminder_count: number
  prompt_status: string
  prompt_error: string | null
  prompt_completed_at: string | null
  created_at: string
  updated_at: string
}

export interface AgentSessionWatchRow {
  id: string
  project_id: string | null
  watcher_agent_id: string
  watcher_session_id: string
  watched_agent_id: string
  watched_session_id: string
  related_info_json: string
  once: number
  status: string
  trigger_count: number
  triggered_at: string | null
  triggered_message_id: string | null
  triggered_turn_id: string | null
  last_error: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateAgentSessionMessageInput {
  projectId?: string | null
  sourceAgentId: string
  sourceSessionId: string
  targetAgentId: string
  targetSessionId: string
  content: string
  relatedInfo?: Record<string, unknown>
  needReply?: boolean
}

export interface CreateAgentSessionWatchInput {
  projectId?: string | null
  watcherAgentId: string
  watcherSessionId: string
  watchedAgentId: string
  watchedSessionId: string
  relatedInfo?: Record<string, unknown>
  once?: boolean
}

export const agentSessionMessageStore = {
  create(input: CreateAgentSessionMessageInput): AgentSessionMessageRow {
    const now = new Date().toISOString()
    const row: AgentSessionMessageRow = {
      id: `amsg-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId ?? null,
      source_agent_id: input.sourceAgentId,
      source_session_id: input.sourceSessionId,
      target_agent_id: input.targetAgentId,
      target_session_id: input.targetSessionId,
      content: input.content,
      related_info_json: stringifyRecord(input.relatedInfo),
      need_reply: input.needReply ? 1 : 0,
      reply_satisfied_at: null,
      reply_reminder_sent_at: null,
      reply_reminder_count: 0,
      prompt_status: 'queued',
      prompt_error: null,
      prompt_completed_at: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO agent_session_messages (
        id, project_id, source_agent_id, source_session_id, target_agent_id, target_session_id,
        content, related_info_json, need_reply, reply_satisfied_at, reply_reminder_sent_at,
        reply_reminder_count, prompt_status, prompt_error, prompt_completed_at, created_at, updated_at
      )
      VALUES (
        @id, @project_id, @source_agent_id, @source_session_id, @target_agent_id, @target_session_id,
        @content, @related_info_json, @need_reply, @reply_satisfied_at, @reply_reminder_sent_at,
        @reply_reminder_count, @prompt_status, @prompt_error, @prompt_completed_at, @created_at, @updated_at
      )
    `).run(row)
    return row
  },

  get(id: string): AgentSessionMessageRow | undefined {
    return getDb().prepare<[string], AgentSessionMessageRow>('SELECT * FROM agent_session_messages WHERE id = ?').get(id)
  },

  listPendingRepliesForTargetSession(targetSessionId: string): AgentSessionMessageRow[] {
    return getDb().prepare<[string], AgentSessionMessageRow>(`
      SELECT * FROM agent_session_messages
      WHERE target_session_id = ?
        AND need_reply = 1
        AND reply_satisfied_at IS NULL
        AND reply_reminder_count = 0
      ORDER BY created_at ASC
    `).all(targetSessionId)
  },

  markReminderSent(id: string): AgentSessionMessageRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE agent_session_messages
      SET reply_reminder_count = reply_reminder_count + 1,
          reply_reminder_sent_at = ?,
          updated_at = ?
      WHERE id = ? AND reply_satisfied_at IS NULL
    `).run(now, now, id)
    return agentSessionMessageStore.get(id)
  },

  markLatestReplySatisfiedByResponse(response: AgentSessionMessageRow): AgentSessionMessageRow | undefined {
    const candidates = getDb().prepare<{
      projectId: string | null
      sourceSessionId: string
      targetSessionId: string
    }, AgentSessionMessageRow>(`
      SELECT * FROM agent_session_messages
      WHERE source_session_id = @targetSessionId
        AND target_session_id = @sourceSessionId
        AND need_reply = 1
        AND reply_satisfied_at IS NULL
        AND (project_id IS @projectId OR project_id = @projectId)
      ORDER BY created_at DESC
    `).all({
      projectId: response.project_id,
      sourceSessionId: response.source_session_id,
      targetSessionId: response.target_session_id,
    })
    const match = selectReplyMatch(candidates, parseRecord(response.related_info_json))
    if (!match) return undefined
    const now = new Date().toISOString()
    getDb().prepare('UPDATE agent_session_messages SET reply_satisfied_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, match.id)
    return agentSessionMessageStore.get(match.id)
  },

  updatePromptCompleted(id: string): AgentSessionMessageRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE agent_session_messages
      SET prompt_status = 'completed', prompt_error = NULL, prompt_completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id)
    return agentSessionMessageStore.get(id)
  },

  updatePromptFailed(id: string, error: string): AgentSessionMessageRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE agent_session_messages
      SET prompt_status = 'failed', prompt_error = ?, prompt_completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(error, now, now, id)
    return agentSessionMessageStore.get(id)
  },

  hasMessageBetweenSince(sourceSessionId: string, targetSessionId: string, since: string): boolean {
    const row = getDb().prepare<[string, string, string], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM agent_session_messages
      WHERE source_session_id = ?
        AND target_session_id = ?
        AND created_at >= ?
    `).get(sourceSessionId, targetSessionId, since)
    return (row?.count ?? 0) > 0
  },
}

export const agentSessionWatchStore = {
  create(input: CreateAgentSessionWatchInput): AgentSessionWatchRow {
    const now = new Date().toISOString()
    const row: AgentSessionWatchRow = {
      id: `awch-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId ?? null,
      watcher_agent_id: input.watcherAgentId,
      watcher_session_id: input.watcherSessionId,
      watched_agent_id: input.watchedAgentId,
      watched_session_id: input.watchedSessionId,
      related_info_json: stringifyRecord(input.relatedInfo),
      once: input.once === false ? 0 : 1,
      status: 'active',
      trigger_count: 0,
      triggered_at: null,
      triggered_message_id: null,
      triggered_turn_id: null,
      last_error: null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO agent_session_watches (
        id, project_id, watcher_agent_id, watcher_session_id, watched_agent_id, watched_session_id,
        related_info_json, once, status, trigger_count, triggered_at, triggered_message_id,
        triggered_turn_id, last_error, cancelled_at, created_at, updated_at
      )
      VALUES (
        @id, @project_id, @watcher_agent_id, @watcher_session_id, @watched_agent_id, @watched_session_id,
        @related_info_json, @once, @status, @trigger_count, @triggered_at, @triggered_message_id,
        @triggered_turn_id, @last_error, @cancelled_at, @created_at, @updated_at
      )
    `).run(row)
    return row
  },

  get(id: string): AgentSessionWatchRow | undefined {
    return getDb().prepare<[string], AgentSessionWatchRow>('SELECT * FROM agent_session_watches WHERE id = ?').get(id)
  },

  listActiveByWatchedSession(sessionId: string): AgentSessionWatchRow[] {
    return getDb().prepare<[string], AgentSessionWatchRow>(`
      SELECT * FROM agent_session_watches
      WHERE watched_session_id = ? AND status = 'active'
      ORDER BY created_at ASC
    `).all(sessionId)
  },

  markTriggered(id: string, input: { messageId?: string; turnId?: string; once: boolean }): AgentSessionWatchRow | undefined {
    const now = new Date().toISOString()
    const status = input.once ? 'triggered' : 'active'
    getDb().prepare(`
      UPDATE agent_session_watches
      SET status = ?,
          trigger_count = trigger_count + 1,
          triggered_at = ?,
          triggered_message_id = ?,
          triggered_turn_id = ?,
          last_error = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(status, now, input.messageId ?? null, input.turnId ?? null, now, id)
    return agentSessionWatchStore.get(id)
  },

  markFailed(id: string, error: string): AgentSessionWatchRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE agent_session_watches
      SET status = 'failed', last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(error, now, id)
    return agentSessionWatchStore.get(id)
  },

  cancel(id: string, watcherSessionId: string, watcherAgentId: string): AgentSessionWatchRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE agent_session_watches
      SET status = 'cancelled', cancelled_at = ?, updated_at = ?
      WHERE id = ? AND watcher_session_id = ? AND watcher_agent_id = ?
    `).run(now, now, id, watcherSessionId, watcherAgentId)
    return agentSessionWatchStore.get(id)
  },
}

function stringifyRecord(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function selectReplyMatch(candidates: AgentSessionMessageRow[], responseInfo: Record<string, unknown>): AgentSessionMessageRow | undefined {
  const responseKeys = Object.keys(responseInfo)
  if (responseKeys.length === 0) return candidates[0]
  return candidates.find((candidate) => {
    const candidateInfo = parseRecord(candidate.related_info_json)
    return responseKeys.some((key) => candidateInfo[key] === responseInfo[key])
  }) ?? candidates[0]
}
