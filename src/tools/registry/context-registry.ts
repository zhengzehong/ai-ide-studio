import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getDb } from '../../store/db.js'
import { createChildLogger } from '../../core/logger.js'

const log = createChildLogger('tool-context-registry')
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export interface ToolContextRecord {
  id: string
  tokenHash: string
  sessionId: string
  acpSessionId?: string
  agentId: string
  projectId?: string
  visibleTools: string[]
  expiresAt: string
  revokedAt?: string | null
  createdAt: string
}

export interface CreateToolContextInput {
  sessionId: string
  acpSessionId?: string
  agentId: string
  projectId?: string
  visibleTools: string[]
  ttlMs?: number
}

interface ToolContextRow {
  id: string
  token_hash: string
  session_id: string
  acp_session_id: string | null
  agent_id: string
  project_id: string | null
  visible_tools_json: string
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export function createToolContext(input: CreateToolContextInput): { token: string; context: ToolContextRecord } {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const row: ToolContextRow = {
    id: `tctx-${randomUUID().slice(0, 8)}`,
    token_hash: hashToken(token),
    session_id: input.sessionId,
    acp_session_id: input.acpSessionId ?? null,
    agent_id: input.agentId,
    project_id: input.projectId ?? null,
    visible_tools_json: JSON.stringify(input.visibleTools),
    expires_at: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    revoked_at: null,
    created_at: now.toISOString(),
  }

  getDb().prepare(`
    INSERT INTO tool_contexts (id, token_hash, session_id, acp_session_id, agent_id, project_id, visible_tools_json, expires_at, revoked_at, created_at)
    VALUES (@id, @token_hash, @session_id, @acp_session_id, @agent_id, @project_id, @visible_tools_json, @expires_at, @revoked_at, @created_at)
  `).run(row)

  log.info({ contextId: row.id, sessionId: row.session_id, agentId: row.agent_id, toolCount: input.visibleTools.length }, '工具上下文已创建')
  return { token, context: rowToContext(row) }
}

export function validateToolToken(token: string): ToolContextRecord | null {
  const row = getDb().prepare<[string], ToolContextRow>('SELECT * FROM tool_contexts WHERE token_hash = ?').get(hashToken(token))
  if (!row) return null
  if (row.revoked_at) return null
  if (Date.parse(row.expires_at) <= Date.now()) return null
  return rowToContext(row)
}

export function revokeToolContextBySession(sessionId: string): void {
  const revokedAt = new Date().toISOString()
  getDb().prepare('UPDATE tool_contexts SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL').run(revokedAt, sessionId)
  log.info({ sessionId }, '工具上下文已撤销')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function rowToContext(row: ToolContextRow): ToolContextRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    sessionId: row.session_id,
    acpSessionId: row.acp_session_id ?? undefined,
    agentId: row.agent_id,
    projectId: row.project_id ?? undefined,
    visibleTools: parseVisibleTools(row.visible_tools_json),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }
}

function parseVisibleTools(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
