import { randomUUID } from 'crypto'
import { getDb } from './db.js'

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
  timestamp: string
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

export interface CreateSessionInput {
  agentId: string
  taskId?: string
  acpSessionId?: string
  projectId?: string
}

export interface AppendMessageInput {
  role: string
  content: string
  thinking?: string
  toolCalls?: unknown[]
  decision?: unknown
  attachments?: unknown[]
}

export interface AppendEventInput {
  type: string
  agentId?: string | null
  acpSessionId?: string | null
  messageId?: string | null
  role?: string | null
  payload: unknown
}

export const sessionStore = {
  create(input: CreateSessionInput): SessionRow {
    const session: SessionRow = {
      id: `sess-${randomUUID().slice(0, 8)}`,
      agent_id: input.agentId,
      task_id: input.taskId || null,
      acp_session_id: input.acpSessionId || null,
      status: 'active',
      stage: '',
      started_at: new Date().toISOString(),
      closed_at: null,
      project_id: input.projectId ?? null,
    }
    getDb().prepare(`
      INSERT INTO sessions (id, agent_id, task_id, acp_session_id, status, stage, started_at, closed_at, project_id)
      VALUES (@id, @agent_id, @task_id, @acp_session_id, @status, @stage, @started_at, @closed_at, @project_id)
    `).run(session)
    return session
  },

  get(id: string): SessionRow | undefined {
    return getDb().prepare<[string], SessionRow>('SELECT * FROM sessions WHERE id = ?').get(id)
  },

  list(agentId?: string, projectId?: string): SessionRow[] {
    if (agentId && projectId) {
      return getDb().prepare<[string, string], SessionRow>('SELECT * FROM sessions WHERE agent_id = ? AND project_id = ? ORDER BY started_at ASC').all(agentId, projectId)
    }
    if (agentId) {
      return getDb().prepare<[string], SessionRow>('SELECT * FROM sessions WHERE agent_id = ? ORDER BY started_at ASC').all(agentId)
    }
    if (projectId) {
      return getDb().prepare<[string], SessionRow>('SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at ASC').all(projectId)
    }
    return getDb().prepare<[], SessionRow>('SELECT * FROM sessions ORDER BY started_at ASC').all()
  },

  listByTask(taskId: string): SessionRow[] {
    return getDb().prepare<[string], SessionRow>('SELECT * FROM sessions WHERE task_id = ? ORDER BY started_at ASC').all(taskId)
  },

  updateStatus(id: string, status: string): void {
    const closedAt = status === 'closed' ? new Date().toISOString() : null
    getDb().prepare(`
      UPDATE sessions
      SET status = ?, closed_at = CASE WHEN ? IS NULL THEN closed_at ELSE ? END
      WHERE id = ?
    `).run(status, closedAt, closedAt, id)
  },

  updateAcpSessionId(id: string, acpSessionId: string): void {
    getDb().prepare('UPDATE sessions SET acp_session_id = ? WHERE id = ?').run(acpSessionId, id)
  },

  updateStage(id: string, stage: string): void {
    getDb().prepare('UPDATE sessions SET stage = ? WHERE id = ?').run(stage, id)
  },
}

export const messageStore = {
  append(sessionId: string, input: AppendMessageInput): MessageRow {
    const msg: MessageRow = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      session_id: sessionId,
      role: input.role,
      content: input.content,
      thinking: input.thinking || null,
      tool_calls_json: input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      decision_json: input.decision ? JSON.stringify(input.decision) : null,
      attachments_json: input.attachments ? JSON.stringify(input.attachments) : null,
      timestamp: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO messages (id, session_id, role, content, thinking, tool_calls_json, decision_json, attachments_json, timestamp)
      VALUES (@id, @session_id, @role, @content, @thinking, @tool_calls_json, @decision_json, @attachments_json, @timestamp)
    `).run(msg)
    return msg
  },

  get(id: string): MessageRow | undefined {
    return getDb().prepare<[string], MessageRow>('SELECT * FROM messages WHERE id = ?').get(id)
  },

  list(sessionId: string, opts?: { limit?: number; before?: string }): MessageRow[] {
    const limit = opts?.limit || 100
    if (opts?.before) {
      return getDb().prepare<{ sessionId: string; before: string; limit: number }, MessageRow>(`
        SELECT * FROM messages
        WHERE session_id = @sessionId AND timestamp < @before
        ORDER BY timestamp DESC
        LIMIT @limit
      `).all({ sessionId, before: opts.before, limit }).reverse()
    }
    return getDb().prepare<{ sessionId: string; limit: number }, MessageRow>(`
      SELECT * FROM messages
      WHERE session_id = @sessionId
      ORDER BY timestamp DESC
      LIMIT @limit
    `).all({ sessionId, limit }).reverse()
  },

  updateContent(id: string, content: string): void {
    getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
  },
}

export const eventStore = {
  append(sessionId: string, input: AppendEventInput): SessionEventRow {
    const db = getDb()
    const last = db.prepare<[string], { sequence: number }>('SELECT sequence FROM session_events WHERE session_id = ? ORDER BY sequence DESC LIMIT 1').get(sessionId)
    const ev: SessionEventRow = {
      id: `evt-${randomUUID().slice(0, 8)}`,
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
}
