import { randomUUID } from 'crypto'
import { createChildLogger } from '../core/logger.js'
import { getDb } from './db.js'
import { fileChangesJsonFromToolCalls, parseFileChangesJson } from './file-changes.js'
import { countToolCalls } from './tool-call-history.js'

export type SessionRuntimeState = 'running' | 'idle'

export interface SessionRow {
  id: string
  agent_id: string
  task_id: string | null
  acp_session_id: string | null
  status: string
  stage: string
  started_at: string
  closed_at: string | null
  project_id: string | null
  title: string | null
  updated_at: string | null
  last_message_at: string | null
  last_read_at: string | null
  archived_at: string | null
  deleted_at: string | null
  runtime_preferences_json: string | null
  sort_order: number | null
}

export interface SessionListRow extends SessionRow {
  activity_state: SessionRuntimeState
}

export interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  thinking: string | null
  tool_calls_json: string | null
  decision_json: string | null
  attachments_json: string | null
  file_changes_json: string | null
  status?: string
  started_at?: string | null
  completed_at?: string | null
  stats_json?: string | null
  process_item_count?: number
  timestamp: string
  has_tool_calls?: boolean
  tool_call_count?: number
  has_file_changes?: boolean
  file_change_count?: number
}

export interface SessionEventRow {
  id: string
  session_id: string
  agent_id: string | null
  acp_session_id: string | null
  message_id: string | null
  type: string
  role: string | null
  payload_json: string
  sequence: number
  created_at: string
}

const log = createChildLogger('store:sessions')

const RUNNING_STAGES = [
  '\u6b63\u5728\u51c6\u5907 Agent...',
  '\u6b63\u5728\u542f\u52a8 Agent...',
  'Agent \u5df2\u5c31\u7eea',
  '\u6b63\u5728\u6062\u590d\u4f1a\u8bdd...',
  '\u6b63\u5728\u8fde\u63a5\u4f1a\u8bdd...',
  '\u4f1a\u8bdd\u5df2\u8fde\u63a5',
  '\u6b63\u5728\u601d\u8003...',
]
const INTERRUPTED_STAGE = '\u751f\u6210\u5df2\u4e2d\u65ad\uff0c\u53ef\u91cd\u65b0\u53d1\u9001'
const INTERRUPTED_ERROR = '\u670d\u52a1\u91cd\u542f\uff0c\u751f\u6210\u5df2\u4e2d\u65ad'


export interface CreateSessionInput {
  agentId: string
  taskId?: string
  acpSessionId?: string
  projectId?: string
}

export interface SessionRuntimePreferences {
  modelId?: string
  modeId?: string
  config?: Record<string, string | boolean>
}

export interface AppendMessageInput {
  id?: string
  role: string
  content: string
  thinking?: string
  toolCalls?: unknown[]
  decision?: unknown
  attachments?: unknown[]
  status?: string
  startedAt?: string
  completedAt?: string | null
  stats?: unknown
  fileChangesJson?: string | null
}

export interface AppendEventInput {
  type: string
  agentId?: string | null
  acpSessionId?: string | null
  messageId?: string | null
  role?: string | null
  payload: unknown
}

export interface CopyLatestMessagesResult {
  messageCount: number
  eventCount: number
}

export const sessionStore = {
  create(input: CreateSessionInput): SessionRow {
    const now = new Date().toISOString()
    const session: SessionRow = {
      id: `sess-${randomUUID().slice(0, 8)}`,
      agent_id: input.agentId,
      task_id: input.taskId || null,
      acp_session_id: input.acpSessionId || null,
      status: 'active',
      stage: '',
      started_at: now,
      closed_at: null,
      project_id: input.projectId ?? null,
      title: null,
      updated_at: now,
      last_message_at: null,
      last_read_at: now,
      archived_at: null,
      deleted_at: null,
      runtime_preferences_json: null,
      sort_order: nextSessionSortOrder(input.projectId ?? null, input.agentId),
    }
    getDb().prepare(`
      INSERT INTO sessions (
        id, agent_id, task_id, acp_session_id, status, stage, started_at, closed_at,
        project_id, title, updated_at, last_message_at, archived_at, deleted_at, runtime_preferences_json, sort_order
      )
      VALUES (
        @id, @agent_id, @task_id, @acp_session_id, @status, @stage, @started_at, @closed_at,
        @project_id, @title, @updated_at, @last_message_at, @archived_at, @deleted_at, @runtime_preferences_json, @sort_order
      )
    `).run(session)
    return session
  },

  get(id: string): SessionRow | undefined {
    return getDb().prepare<[string], SessionRow>('SELECT * FROM sessions WHERE id = ?').get(id)
  },

  list(agentId?: string, projectId?: string): SessionRow[] {
    return listSessions(agentId, projectId)
  },

  reorder(projectId: string, agentId: string, sessionIds: string[]): SessionRow[] {
    if (!projectId) throw new Error('projectId is required')
    if (!agentId) throw new Error('agentId is required')
    const uniqueIds = uniqueOrderedIds(sessionIds)
    const current = sessionStore.list(agentId, projectId)
    const currentById = new Map(current.map((session) => [session.id, session]))
    for (const sessionId of uniqueIds) {
      if (!currentById.has(sessionId)) throw new Error(`Session does not belong to agent/project: ${sessionId}`)
    }
    const orderedIds = [...uniqueIds, ...current.filter((session) => !uniqueIds.includes(session.id)).map((session) => session.id)]
    const update = getDb().prepare('UPDATE sessions SET sort_order = ?, updated_at = ? WHERE id = ? AND agent_id = ? AND project_id = ?')
    const now = new Date().toISOString()
    const apply = getDb().transaction(() => {
      orderedIds.forEach((sessionId, index) => update.run(index + 1, now, sessionId, agentId, projectId))
    })
    apply()
    return sessionStore.list(agentId, projectId)
  },

  listWithRuntimeState(
    agentId?: string,
    projectId?: string,
    isPromptActive: (sessionId: string) => boolean = () => false,
  ): SessionListRow[] {
    return listSessions(agentId, projectId).map((session) => ({
      ...session,
      activity_state: resolveSessionRuntimeState(session, isPromptActive),
    }))
  },

  listByTask(taskId: string): SessionRow[] {
    return getDb().prepare<[string], SessionRow>('SELECT * FROM sessions WHERE task_id = ? ORDER BY started_at ASC').all(taskId)
  },

  reconcileInterruptedStages(): { interrupted: SessionRow[]; cleared: SessionRow[] } {
    markRunningAgentMessagesInterrupted()
    const placeholders = RUNNING_STAGES.map(() => '?').join(', ')
    const candidates = getDb()
      .prepare<string[], SessionRow>(`
        SELECT * FROM sessions
        WHERE stage IN (${placeholders}) AND deleted_at IS NULL
        ORDER BY updated_at ASC
      `)
      .all(...RUNNING_STAGES)

    const interrupted: SessionRow[] = []
    const cleared: SessionRow[] = []

    for (const session of candidates) {
      if (session.status !== 'active' || hasDoneAfterLastUser(session.id)) {
        sessionStore.updateStage(session.id, '')
        const updated = sessionStore.get(session.id)
        cleared.push(updated ?? { ...session, stage: '' })
        continue
      }

      const event = eventStore.append(session.id, {
        type: 'lifecycle.interrupted',
        agentId: session.agent_id,
        messageId: `interrupted-${Date.now()}`,
        role: 'system',
        payload: { content: INTERRUPTED_STAGE, reason: 'startup_recovery' },
      })
      eventStore.append(session.id, {
        type: 'message.done',
        agentId: session.agent_id,
        messageId: event.message_id,
        role: 'agent',
        payload: { messageId: event.message_id, stopReason: 'error', error: INTERRUPTED_ERROR },
      })
      sessionStore.updateStage(session.id, INTERRUPTED_STAGE)
      const updated = sessionStore.get(session.id)
      interrupted.push(updated ?? { ...session, stage: INTERRUPTED_STAGE })
    }

    return { interrupted, cleared }
  },

  updateStatus(id: string, status: string): void {
    const now = new Date().toISOString()
    const closedAt = status === 'closed' ? now : null
    getDb().prepare(`
      UPDATE sessions
      SET
        status = ?,
        updated_at = ?,
        closed_at = CASE WHEN ? IS NULL THEN closed_at ELSE ? END
      WHERE id = ?
    `).run(status, now, closedAt, closedAt, id)
  },

  updateAcpSessionId(id: string, acpSessionId: string): void {
    getDb().prepare('UPDATE sessions SET acp_session_id = ?, updated_at = ? WHERE id = ?').run(acpSessionId, new Date().toISOString(), id)
  },

  updateStage(id: string, stage: string): void {
    getDb().prepare('UPDATE sessions SET stage = ?, updated_at = ? WHERE id = ?').run(stage, new Date().toISOString(), id)
  },

  getRuntimePreferences(id: string): SessionRuntimePreferences {
    const session = sessionStore.get(id)
    return parseRuntimePreferences(session?.runtime_preferences_json)
  },

  updateRuntimePreferences(id: string, patch: SessionRuntimePreferences): SessionRuntimePreferences {
    const current = sessionStore.getRuntimePreferences(id)
    const next: SessionRuntimePreferences = {
      ...current,
      ...patch,
      config: patch.config ? { ...(current.config ?? {}), ...patch.config } : current.config,
    }
    getDb().prepare('UPDATE sessions SET runtime_preferences_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(next), new Date().toISOString(), id)
    return next
  },

  clearStageIfRunning(id: string): SessionRow | undefined {
    const session = sessionStore.get(id)
    if (!session || !RUNNING_STAGES.includes(session.stage)) return undefined
    sessionStore.updateStage(id, '')
    return sessionStore.get(id)
  },

  updateTitle(id: string, title: string): SessionRow | undefined {
    const nextTitle = title.trim()
    if (!nextTitle) throw new Error('Session title cannot be empty')
    getDb().prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(nextTitle, new Date().toISOString(), id)
    return sessionStore.get(id)
  },

  updateTitleIfEmpty(id: string, title: string): SessionRow | undefined {
    const nextTitle = title.trim()
    if (!nextTitle) return sessionStore.get(id)
    getDb().prepare(`
      UPDATE sessions
      SET title = ?, updated_at = ?
      WHERE id = ? AND (title IS NULL OR TRIM(title) = '')
    `).run(nextTitle, new Date().toISOString(), id)
    return sessionStore.get(id)
  },

  archive(id: string): SessionRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare('UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    return sessionStore.get(id)
  },

  delete(id: string): SessionRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare('UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    return sessionStore.get(id)
  },

  touch(id: string, timestamp = new Date().toISOString()): void {
    getDb().prepare('UPDATE sessions SET updated_at = ?, last_message_at = ? WHERE id = ?').run(timestamp, timestamp, id)
  },

  markRead(id: string, timestamp = new Date().toISOString()): string {
    getDb().prepare('UPDATE sessions SET last_read_at = ? WHERE id = ?').run(timestamp, id)
    return timestamp
  },
}



function markRunningAgentMessagesInterrupted(): void {
  const now = new Date().toISOString()
  getDb().prepare(`
    UPDATE turn_process_items
    SET
      status = 'failed',
      updated_at = @now
    WHERE status IN ('running', 'pending', 'in_progress')
  `).run({ now })

  getDb().prepare(`
    UPDATE messages
    SET
      status = 'failed',
      content = CASE WHEN TRIM(content) = '' THEN @error ELSE content END,
      completed_at = @now,
      timestamp = @now
    WHERE role = 'agent' AND status = 'running'
  `).run({ error: INTERRUPTED_ERROR, now })
}

function listSessions(agentId?: string, projectId?: string): SessionRow[] {
  const orderBy = 'ORDER BY COALESCE(sort_order, 9223372036854775807) ASC, started_at ASC, id ASC'
  if (agentId && projectId) {
    return getDb().prepare<[string, string], SessionRow>(`SELECT * FROM sessions WHERE agent_id = ? AND project_id = ? AND deleted_at IS NULL ${orderBy}`).all(agentId, projectId)
  }
  if (agentId) {
    return getDb().prepare<[string], SessionRow>(`SELECT * FROM sessions WHERE agent_id = ? AND deleted_at IS NULL ${orderBy}`).all(agentId)
  }
  if (projectId) {
    return getDb().prepare<[string], SessionRow>(`SELECT * FROM sessions WHERE project_id = ? AND deleted_at IS NULL ${orderBy}`).all(projectId)
  }
  return getDb().prepare<[], SessionRow>('SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY started_at ASC').all()
}

function nextSessionSortOrder(projectId: string | null, agentId: string): number {
  const db = getDb()
  const row = projectId
    ? db.prepare<{ projectId: string; agentId: string }, { min_order: number | null }>(`
      SELECT MIN(sort_order) AS min_order FROM sessions
      WHERE project_id = @projectId AND agent_id = @agentId
    `).get({ projectId, agentId })
    : db.prepare<[string], { min_order: number | null }>(`
      SELECT MIN(sort_order) AS min_order FROM sessions
      WHERE project_id IS NULL AND agent_id = ?
    `).get(agentId)
  return (row?.min_order ?? 1) - 1
}

function uniqueOrderedIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function resolveSessionRuntimeState(
  session: SessionRow,
  isPromptActive: (sessionId: string) => boolean,
): SessionRuntimeState {
  if (isPromptActive(session.id)) return 'running'
  if (hasRunningAgentMessage(session.id)) return 'running'
  if (hasRunningProcessItem(session.id)) return 'running'
  if (session.status !== 'active') return 'idle'
  if (RUNNING_STAGES.includes(session.stage)) return 'running'
  return 'idle'
}

function parseRuntimePreferences(raw: string | null | undefined): SessionRuntimePreferences {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    const prefs: SessionRuntimePreferences = {}
    if (typeof record.modelId === 'string' && record.modelId.trim()) prefs.modelId = record.modelId
    if (typeof record.modeId === 'string' && record.modeId.trim()) prefs.modeId = record.modeId
    if (record.config && typeof record.config === 'object' && !Array.isArray(record.config)) {
      const config: Record<string, string | boolean> = {}
      for (const [key, value] of Object.entries(record.config as Record<string, unknown>)) {
        if (typeof value === 'string' || typeof value === 'boolean') config[key] = value
      }
      if (Object.keys(config).length > 0) prefs.config = config
    }
    return prefs
  } catch {
    return {}
  }
}

function hasRunningAgentMessage(sessionId: string): boolean {
  const row = getDb()
    .prepare<[string], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM messages
      WHERE session_id = ? AND role = 'agent' AND status = 'running'
    `)
    .get(sessionId)
  return (row?.count ?? 0) > 0
}

function hasRunningProcessItem(sessionId: string): boolean {
  const row = getDb()
    .prepare<[string], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM turn_process_items
      WHERE session_id = ? AND status IN ('running', 'pending', 'in_progress')
    `)
    .get(sessionId)
  return (row?.count ?? 0) > 0
}

function hasDoneAfterLastUser(sessionId: string): boolean {
  const lastUser = getDb()
    .prepare<[string], { sequence: number }>(`
      SELECT sequence FROM session_events
      WHERE session_id = ? AND type = 'message.user'
      ORDER BY sequence DESC
      LIMIT 1
    `)
    .get(sessionId)
  if (!lastUser) return true
  const done = getDb()
    .prepare<{ sessionId: string; sequence: number }, { count: number }>(`
      SELECT COUNT(*) AS count FROM session_events
      WHERE session_id = @sessionId AND type = 'message.done' AND sequence > @sequence
    `)
    .get({ sessionId, sequence: lastUser.sequence })
  return (done?.count ?? 0) > 0
}

export const messageStore = {
  append(sessionId: string, input: AppendMessageInput): MessageRow {
    const msg: MessageRow = {
      id: input.id ?? `msg-${randomUUID().slice(0, 8)}`,
      session_id: sessionId,
      role: input.role,
      content: input.content,
      thinking: input.thinking || null,
      tool_calls_json: input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      decision_json: input.decision ? JSON.stringify(input.decision) : null,
      attachments_json: input.attachments ? JSON.stringify(input.attachments) : null,
      file_changes_json: input.fileChangesJson ?? fileChangesJsonFromToolCalls(input.toolCalls),
      status: input.status ?? 'completed',
      started_at: input.startedAt ?? null,
      completed_at: input.completedAt ?? (input.status && input.status !== 'running' ? new Date().toISOString() : null),
      stats_json: input.stats ? JSON.stringify(input.stats) : null,
      process_item_count: 0,
      timestamp: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO messages (
        id, session_id, role, content, thinking, tool_calls_json, decision_json,
        attachments_json, file_changes_json, status, started_at, completed_at,
        stats_json, process_item_count, timestamp
      )
      VALUES (
        @id, @session_id, @role, @content, @thinking, @tool_calls_json, @decision_json,
        @attachments_json, @file_changes_json, @status, @started_at, @completed_at,
        @stats_json, @process_item_count, @timestamp
      )
    `).run(msg)
    log.debug(
      {
        sessionId,
        messageId: msg.id,
        role: msg.role,
        contentLength: msg.content.length,
        thinkingLength: msg.thinking?.length ?? 0,
        hasToolCalls: !!msg.tool_calls_json,
        toolCallCount: countToolCalls(msg.tool_calls_json),
        hasFileChanges: !!msg.file_changes_json,
        hasAttachments: !!msg.attachments_json,
        timestamp: msg.timestamp,
      },
      'message persisted',
    )
    return msg
  },

  get(id: string): MessageRow | undefined {
    return getDb().prepare<[string], MessageRow>('SELECT * FROM messages WHERE id = ?').get(id)
  },

  list(sessionId: string, opts?: { limit?: number; before?: string; includeToolCalls?: boolean; includeLatestToolCalls?: boolean }): MessageRow[] {
    const limit = opts?.limit || 100
    const includeToolCalls = opts?.includeToolCalls === true
    const includeLatestToolCalls = opts?.includeLatestToolCalls !== false
    const rows = opts?.before
      ? getDb().prepare<{ sessionId: string; before: string; limit: number }, MessageRow>(`
        SELECT * FROM messages
        WHERE session_id = @sessionId AND timestamp < @before
        ORDER BY timestamp DESC
        LIMIT @limit
      `).all({ sessionId, before: opts.before, limit }).reverse()
      : getDb().prepare<{ sessionId: string; limit: number }, MessageRow>(`
        SELECT * FROM messages
        WHERE session_id = @sessionId
        ORDER BY timestamp DESC
        LIMIT @limit
      `).all({ sessionId, limit }).reverse()
    const latestToolMessageId = includeLatestToolCalls ? findLatestToolMessageId(rows) : null
    return rows.map((row) => lightweightMessage(row, includeToolCalls || row.id === latestToolMessageId))
  },

  updateContent(id: string, content: string): void {
    getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
  },

  updateRunningSnapshot(id: string, content: string): void {
    getDb().prepare(`
      UPDATE messages
      SET content = ?, timestamp = ?
      WHERE id = ? AND role = 'agent' AND status = 'running'
    `).run(content, new Date().toISOString(), id)
  },

  completeAgentMessage(
    id: string,
    input: { content: string; thinking?: string | null; toolCalls?: unknown[]; status: string; stats?: unknown; fileChangesJson?: string | null },
  ): MessageRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE messages
      SET content = @content,
        thinking = @thinking,
        tool_calls_json = @tool_calls_json,
        decision_json = @decision_json,
        stats_json = @stats_json,
        file_changes_json = @file_changes_json,
        status = @status,
        completed_at = @completed_at,
        timestamp = @timestamp
      WHERE id = @id AND role = 'agent'
    `).run({
      id,
      content: input.content,
      thinking: null,
      tool_calls_json: null,
      decision_json: input.stats ? JSON.stringify(input.stats) : null,
      stats_json: input.stats ? JSON.stringify(input.stats) : null,
      file_changes_json: input.fileChangesJson ?? fileChangesJsonFromToolCalls(input.toolCalls),
      status: input.status,
      completed_at: now,
      timestamp: now,
    })
    return messageStore.get(id)
  },

  copyLatestWithEvents(sourceSessionId: string, targetSessionId: string, limit: number): CopyLatestMessagesResult {
    const db = getDb()
    const sourceMessages = db.prepare<{ sessionId: string; limit: number }, MessageRow>(`
      SELECT * FROM messages
      WHERE session_id = @sessionId
      ORDER BY timestamp DESC
      LIMIT @limit
    `).all({ sessionId: sourceSessionId, limit }).reverse()

    const messageIdMap = new Map<string, string>()
    const insertMessage = db.prepare(`
      INSERT INTO messages (
        id, session_id, role, content, thinking, tool_calls_json, decision_json,
        attachments_json, file_changes_json, status, started_at, completed_at,
        stats_json, process_item_count, timestamp
      )
      VALUES (
        @id, @session_id, @role, @content, @thinking, @tool_calls_json, @decision_json,
        @attachments_json, @file_changes_json, @status, @started_at, @completed_at,
        @stats_json, @process_item_count, @timestamp
      )
    `)
    const insertEvent = db.prepare(`
      INSERT INTO session_events (
        id, session_id, agent_id, acp_session_id, message_id, type, role, payload_json, sequence, created_at
      )
      VALUES (
        @id, @session_id, @agent_id, @acp_session_id, @message_id, @type, @role, @payload_json, @sequence, @created_at
      )
    `)
    const insertProcessItem = db.prepare(`
      INSERT INTO turn_process_items (
        id, session_id, message_id, sequence, kind, status, title, summary, preview,
        content, detail_json, meta_json, created_at, updated_at
      )
      VALUES (
        @id, @session_id, @message_id, @sequence, @kind, @status, @title, @summary, @preview,
        @content, @detail_json, @meta_json, @created_at, @updated_at
      )
    `)

    const copied = db.transaction(() => {
      for (const sourceMessage of sourceMessages) {
        const copiedMessage = {
          ...sourceMessage,
          id: `msg-${randomUUID().slice(0, 8)}`,
          session_id: targetSessionId,
          status: sourceMessage.status ?? 'completed',
          started_at: sourceMessage.started_at ?? null,
          completed_at: sourceMessage.completed_at ?? null,
          stats_json: sourceMessage.stats_json ?? null,
          process_item_count: sourceMessage.process_item_count ?? 0,
        }
        messageIdMap.set(sourceMessage.id, copiedMessage.id)
        insertMessage.run(copiedMessage)
      }

      if (messageIdMap.size === 0) return { messageCount: 0, eventCount: 0 }

      const sourceMessageIds = Array.from(messageIdMap.keys())
      const placeholders = sourceMessageIds.map(() => '?').join(', ')
      const sourceEvents = db.prepare<string[], SessionEventRow>(`
        SELECT * FROM session_events
        WHERE session_id = ?
          AND (
            message_id IN (${placeholders})
            OR json_extract(payload_json, '$.messageId') IN (${placeholders})
          )
        ORDER BY sequence ASC
      `).all(sourceSessionId, ...sourceMessageIds, ...sourceMessageIds)

      let copiedEventCount = 0
      for (const sourceEvent of sourceEvents) {
        const payload = remapEventPayload(sourceEvent.payload_json, messageIdMap)
        const nextMessageId = sourceEvent.message_id ? messageIdMap.get(sourceEvent.message_id) ?? null : null
        copiedEventCount += 1
        insertEvent.run({
          id: `evt-${randomUUID()}`,
          session_id: targetSessionId,
          agent_id: sourceEvent.agent_id,
          acp_session_id: null,
          message_id: nextMessageId,
          type: sourceEvent.type,
          role: sourceEvent.role,
          payload_json: JSON.stringify(payload),
          sequence: copiedEventCount,
          created_at: sourceEvent.created_at,
        })
      }

      const sourceProcessItems = db.prepare<string[], {
        id: string
        session_id: string
        message_id: string
        sequence: number
        kind: string
        status: string | null
        title: string | null
        summary: string | null
        preview: string | null
        content: string | null
        detail_json: string | null
        meta_json: string | null
        created_at: string
        updated_at: string
      }>(`
        SELECT * FROM turn_process_items
        WHERE session_id = ? AND message_id IN (${placeholders})
        ORDER BY message_id ASC, sequence ASC
      `).all(sourceSessionId, ...sourceMessageIds)

      for (const sourceItem of sourceProcessItems) {
        const nextMessageId = messageIdMap.get(sourceItem.message_id)
        if (!nextMessageId) continue
        insertProcessItem.run({
          ...sourceItem,
          id: `tpi-${randomUUID().slice(0, 8)}`,
          session_id: targetSessionId,
          message_id: nextMessageId,
        })
      }

      return { messageCount: sourceMessages.length, eventCount: copiedEventCount }
    })()

    log.info(
      { sourceSessionId, targetSessionId, messageCount: copied.messageCount, eventCount: copied.eventCount },
      'session recent history copied',
    )
    return copied
  },
}

function findLatestToolMessageId(rows: MessageRow[]): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].tool_calls_json) return rows[index].id
  }
  return null
}

function lightweightMessage(row: MessageRow, includeToolCalls: boolean): MessageRow {
  const hasToolCalls = !!row.tool_calls_json
  const fileChanges = parseFileChangesJson(row.file_changes_json)
  const fileChangeFields = {
    has_file_changes: !!fileChanges?.files.length,
    file_change_count: fileChanges?.files.length,
  }
  if (includeToolCalls || !hasToolCalls) {
    return {
      ...row,
      has_tool_calls: hasToolCalls,
      tool_call_count: countToolCalls(row.tool_calls_json),
      ...fileChangeFields,
    }
  }
  return {
    ...row,
    tool_calls_json: null,
    has_tool_calls: true,
    tool_call_count: countToolCalls(row.tool_calls_json),
    ...fileChangeFields,
  }
}

function remapEventPayload(payloadJson: string, messageIdMap: Map<string, string>): unknown {
  let payload: unknown
  try {
    payload = JSON.parse(payloadJson) as unknown
  } catch {
    return {}
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const record = { ...(payload as Record<string, unknown>) }
  if (typeof record.messageId === 'string') {
    record.messageId = messageIdMap.get(record.messageId) ?? record.messageId
  }
  return record
}

export const eventStore = {
  append(sessionId: string, input: AppendEventInput): SessionEventRow {
    const db = getDb()
    const last = db.prepare<[string], { sequence: number }>('SELECT sequence FROM session_events WHERE session_id = ? ORDER BY sequence DESC LIMIT 1').get(sessionId)
    const ev: SessionEventRow = {
      id: `evt-${randomUUID()}`,
      session_id: sessionId,
      agent_id: input.agentId ?? null,
      acp_session_id: input.acpSessionId ?? null,
      message_id: input.messageId ?? null,
      type: input.type,
      role: input.role ?? null,
      payload_json: JSON.stringify(input.payload),
      sequence: (last?.sequence ?? 0) + 1,
      created_at: new Date().toISOString(),
    }
    db.prepare(`
      INSERT INTO session_events (id, session_id, agent_id, acp_session_id, message_id, type, role, payload_json, sequence, created_at)
      VALUES (@id, @session_id, @agent_id, @acp_session_id, @message_id, @type, @role, @payload_json, @sequence, @created_at)
    `).run(ev)
    log.debug(
      {
        sessionId,
        eventId: ev.id,
        sequence: ev.sequence,
        eventType: ev.type,
        messageId: ev.message_id,
        role: ev.role,
        payloadBytes: Buffer.byteLength(ev.payload_json, 'utf8'),
        createdAt: ev.created_at,
      },
      'session event appended',
    )
    return ev
  },

  list(sessionId: string, opts?: { limit?: number; afterSequence?: number }): SessionEventRow[] {
    const limit = opts?.limit || 500
    if (opts?.afterSequence != null) {
      return getDb().prepare<{ sessionId: string; afterSequence: number; limit: number }, SessionEventRow>(`
        SELECT * FROM session_events
        WHERE session_id = @sessionId AND sequence > @afterSequence
        ORDER BY sequence DESC
        LIMIT @limit
      `).all({ sessionId, afterSequence: opts.afterSequence, limit }).reverse()
    }
    return getDb().prepare<{ sessionId: string; limit: number }, SessionEventRow>(`
      SELECT * FROM session_events
      WHERE session_id = @sessionId
      ORDER BY sequence DESC
      LIMIT @limit
    `).all({ sessionId, limit }).reverse()
  },

  listByMessage(sessionId: string, messageId: string): SessionEventRow[] {
    return getDb().prepare<{ sessionId: string; messageId: string }, SessionEventRow>(`
      WITH turn_bounds AS (
        SELECT
          MIN(sequence) AS start_sequence,
          (
            SELECT MIN(done.sequence)
            FROM session_events done
            WHERE done.session_id = @sessionId
              AND done.type = 'message.done'
              AND done.sequence > MIN(start.sequence)
          ) AS done_sequence,
          (
            SELECT MIN(next.sequence)
            FROM session_events next
            WHERE next.session_id = @sessionId
              AND next.message_id IS NOT NULL
              AND next.message_id <> @messageId
              AND next.type IN ('message.chunk', 'thinking.chunk', 'tool.call', 'tool.update')
              AND next.sequence > MIN(start.sequence)
          ) AS next_turn_sequence
        FROM session_events start
        WHERE start.session_id = @sessionId
          AND start.message_id = @messageId
          AND start.type IN ('message.chunk', 'thinking.chunk', 'tool.call', 'tool.update')
      )
      SELECT events.*
      FROM session_events events, turn_bounds
      WHERE events.session_id = @sessionId
        AND turn_bounds.start_sequence IS NOT NULL
        AND events.sequence >= turn_bounds.start_sequence
        AND events.sequence < COALESCE(turn_bounds.next_turn_sequence, 9223372036854775807)
        AND events.sequence <= COALESCE(turn_bounds.done_sequence, 9223372036854775807)
        AND (
          events.message_id = @messageId
          OR (events.type = 'message.done' AND events.sequence = turn_bounds.done_sequence)
        )
      ORDER BY events.sequence ASC
    `).all({ sessionId, messageId })
  },
}
