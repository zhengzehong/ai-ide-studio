import { randomUUID } from 'node:crypto'
import { getDb } from '../../store/db.js'

export type ToolCallStatus = 'running' | 'succeeded' | 'failed' | 'denied' | 'timeout'

export interface ToolCallAuditRow {
  id: string
  session_id: string
  agent_id: string
  project_id: string | null
  tool_name: string
  input_json: string
  output_json: string | null
  status: ToolCallStatus
  started_at: string
  ended_at: string | null
  error: string | null
}

export interface RecordToolCallStartInput {
  sessionId: string
  agentId: string
  projectId?: string
  toolName: string
  input: unknown
  status?: ToolCallStatus
}

export function recordToolCallStart(input: RecordToolCallStartInput): ToolCallAuditRow {
  const row: ToolCallAuditRow = {
    id: `tcall-${randomUUID().slice(0, 8)}`,
    session_id: input.sessionId,
    agent_id: input.agentId,
    project_id: input.projectId ?? null,
    tool_name: input.toolName,
    input_json: JSON.stringify(input.input),
    output_json: null,
    status: input.status ?? 'running',
    started_at: new Date().toISOString(),
    ended_at: null,
    error: null,
  }

  getDb().prepare(`
    INSERT INTO tool_call_audit (id, session_id, agent_id, project_id, tool_name, input_json, output_json, status, started_at, ended_at, error)
    VALUES (@id, @session_id, @agent_id, @project_id, @tool_name, @input_json, @output_json, @status, @started_at, @ended_at, @error)
  `).run(row)
  return row
}

export function finishToolCall(id: string, output: unknown): void {
  getDb().prepare('UPDATE tool_call_audit SET status = ?, output_json = ?, ended_at = ? WHERE id = ?')
    .run('succeeded', JSON.stringify(output), new Date().toISOString(), id)
}

export function failToolCall(id: string, error: string, status: Exclude<ToolCallStatus, 'running' | 'succeeded'> = 'failed'): void {
  getDb().prepare('UPDATE tool_call_audit SET status = ?, error = ?, ended_at = ? WHERE id = ?')
    .run(status, error, new Date().toISOString(), id)
}

export function listToolCalls(sessionId: string): ToolCallAuditRow[] {
  return getDb().prepare<[string], ToolCallAuditRow>('SELECT * FROM tool_call_audit WHERE session_id = ? ORDER BY started_at ASC').all(sessionId)
}
