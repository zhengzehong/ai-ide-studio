import { randomUUID } from 'crypto'
import { getData, persist } from './db.js'

export interface SessionRow {
  id: string
  agent_id: string
  task_id: string | null
  acp_session_id: string | null
  status: string
  stage: string
  started_at: string
  closed_at: string | null
}

export interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  thinking: string | null
  tool_calls_json: string | null
  decision_json: string | null
  timestamp: string
}

export interface CreateSessionInput {
  agentId: string
  taskId?: string
  acpSessionId?: string
}

export interface AppendMessageInput {
  role: string
  content: string
  thinking?: string
  toolCalls?: unknown[]
  decision?: unknown
}

export const sessionStore = {
  create(input: CreateSessionInput): SessionRow {
    const data = getData()
    const id = `sess-${randomUUID().slice(0, 8)}`
    const session: SessionRow = {
      id,
      agent_id: input.agentId,
      task_id: input.taskId || null,
      acp_session_id: input.acpSessionId || null,
      status: 'active',
      stage: '',
      started_at: new Date().toISOString(),
      closed_at: null,
    }
    data.sessions[id] = session
    data.messages[id] = []
    persist()
    return session
  },

  get(id: string): SessionRow | undefined {
    const data = getData()
    return data.sessions[id] as SessionRow | undefined
  },

  list(agentId?: string): SessionRow[] {
    const data = getData()
    const all = Object.values(data.sessions) as SessionRow[]
    if (agentId) return all.filter((s) => s.agent_id === agentId)
    return all
  },

  listByTask(taskId: string): SessionRow[] {
    const data = getData()
    return (Object.values(data.sessions) as SessionRow[]).filter((s) => s.task_id === taskId)
  },

  updateStatus(id: string, status: string): void {
    const data = getData()
    const session = data.sessions[id] as SessionRow | undefined
    if (session) {
      session.status = status
      if (status === 'closed') session.closed_at = new Date().toISOString()
      persist()
    }
  },

  updateAcpSessionId(id: string, acpSessionId: string): void {
    const data = getData()
    const session = data.sessions[id] as SessionRow | undefined
    if (session) {
      session.acp_session_id = acpSessionId
      persist()
    }
  },

  updateStage(id: string, stage: string): void {
    const data = getData()
    const session = data.sessions[id] as SessionRow | undefined
    if (session) {
      session.stage = stage
      persist()
    }
  },
}

export const messageStore = {
  append(sessionId: string, input: AppendMessageInput): MessageRow {
    const data = getData()
    if (!data.messages[sessionId]) data.messages[sessionId] = []

    const msg: MessageRow = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      session_id: sessionId,
      role: input.role,
      content: input.content,
      thinking: input.thinking || null,
      tool_calls_json: input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      decision_json: input.decision ? JSON.stringify(input.decision) : null,
      timestamp: new Date().toISOString(),
    }

    ;(data.messages[sessionId] as MessageRow[]).push(msg)
    persist()
    return msg
  },

  get(id: string): MessageRow | undefined {
    const data = getData()
    for (const msgs of Object.values(data.messages)) {
      const found = (msgs as MessageRow[]).find((m) => m.id === id)
      if (found) return found
    }
    return undefined
  },

  list(sessionId: string, opts?: { limit?: number; before?: string }): MessageRow[] {
    const data = getData()
    let msgs = (data.messages[sessionId] || []) as MessageRow[]
    if (opts?.before) {
      msgs = msgs.filter((m) => m.timestamp < opts.before!)
    }
    const limit = opts?.limit || 100
    return msgs.slice(-limit)
  },

  updateContent(id: string, content: string): void {
    const data = getData()
    for (const msgs of Object.values(data.messages)) {
      const found = (msgs as MessageRow[]).find((m) => m.id === id)
      if (found) {
        found.content = content
        persist()
        return
      }
    }
  },
}
