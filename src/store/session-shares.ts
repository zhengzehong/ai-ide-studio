import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('store:session-shares')

export type SharePermission = 'chat' | 'readonly'
export type ShareToolCallVisibility = 'hide' | 'collapse' | 'expand'

export interface SessionShareRow {
  id: string
  share_token: string
  session_id: string
  agent_id: string
  owner_agent_id: string
  share_name: string
  agent_intro: string
  permission: SharePermission
  tool_call_visibility: ShareToolCallVisibility
  expires_at: string | null
  revoked_at: string | null
  deleted_at: string | null
  visit_count: number
  last_visited_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateShareInput {
  sessionId: string
  agentId: string
  ownerAgentId: string
  shareName: string
  agentIntro: string
  permission?: SharePermission
  toolCallVisibility?: ShareToolCallVisibility
  expiresAt?: string | null
  shareToken?: string
}

export interface UpdateShareInput {
  shareName?: string
  agentIntro?: string
  permission?: SharePermission
  toolCallVisibility?: ShareToolCallVisibility
  expiresAt?: string | null
}

const SHARE_TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateShareToken(length = 32): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += SHARE_TOKEN_ALPHABET[bytes[i]! % SHARE_TOKEN_ALPHABET.length]
  }
  return out
}

export const sessionShareStore = {
  create(input: CreateShareInput): SessionShareRow {
    const now = new Date().toISOString()
    const row: SessionShareRow = {
      id: `shr-${randomUUID().slice(0, 12)}`,
      share_token: input.shareToken ?? generateShareToken(),
      session_id: input.sessionId,
      agent_id: input.agentId,
      owner_agent_id: input.ownerAgentId,
      share_name: input.shareName,
      agent_intro: input.agentIntro,
      permission: input.permission ?? 'chat',
      tool_call_visibility: input.toolCallVisibility ?? 'collapse',
      expires_at: input.expiresAt ?? null,
      revoked_at: null,
      deleted_at: null,
      visit_count: 0,
      last_visited_at: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO session_shares (
        id, share_token, session_id, agent_id, owner_agent_id,
        share_name, agent_intro, permission, tool_call_visibility,
        expires_at, revoked_at, deleted_at, visit_count, last_visited_at,
        created_at, updated_at
      )
      VALUES (
        @id, @share_token, @session_id, @agent_id, @owner_agent_id,
        @share_name, @agent_intro, @permission, @tool_call_visibility,
        @expires_at, @revoked_at, @deleted_at, @visit_count, @last_visited_at,
        @created_at, @updated_at
      )
    `).run(row)
    log.info({ shareId: row.id, sessionId: row.session_id, ownerAgentId: row.owner_agent_id }, 'session share created')
    return row
  },

  getByToken(token: string): SessionShareRow | undefined {
    return getDb()
      .prepare<[string], SessionShareRow>(
        `SELECT * FROM session_shares
         WHERE share_token = ? AND revoked_at IS NULL AND deleted_at IS NULL`,
      )
      .get(token)
  },

  getById(id: string): SessionShareRow | undefined {
    return getDb()
      .prepare<[string], SessionShareRow>('SELECT * FROM session_shares WHERE id = ?')
      .get(id)
  },

  listByOwner(ownerAgentId: string): SessionShareRow[] {
    return getDb()
      .prepare<[string], SessionShareRow>(
        `SELECT * FROM session_shares
         WHERE owner_agent_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all(ownerAgentId)
  },

  listBySession(sessionId: string): SessionShareRow[] {
    return getDb()
      .prepare<[string], SessionShareRow>(
        `SELECT * FROM session_shares
         WHERE session_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all(sessionId)
  },

  update(id: string, fields: UpdateShareInput): SessionShareRow | undefined {
    const current = sessionShareStore.getById(id)
    if (!current) return undefined
    const next: SessionShareRow = {
      ...current,
      share_name: fields.shareName ?? current.share_name,
      agent_intro: fields.agentIntro ?? current.agent_intro,
      permission: fields.permission ?? current.permission,
      tool_call_visibility: fields.toolCallVisibility ?? current.tool_call_visibility,
      expires_at: fields.expiresAt !== undefined ? fields.expiresAt : current.expires_at,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE session_shares
      SET share_name = @share_name,
          agent_intro = @agent_intro,
          permission = @permission,
          tool_call_visibility = @tool_call_visibility,
          expires_at = @expires_at,
          updated_at = @updated_at
      WHERE id = @id
    `).run(next)
    return sessionShareStore.getById(id)
  },

  revoke(id: string): SessionShareRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare('UPDATE session_shares SET revoked_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    log.info({ shareId: id }, 'session share revoked')
    return sessionShareStore.getById(id)
  },

  renew(id: string, expiresAt: string | null): SessionShareRow | undefined {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE session_shares
      SET expires_at = ?, revoked_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(expiresAt, now, id)
    log.info({ shareId: id, expiresAt }, 'session share renewed')
    return sessionShareStore.getById(id)
  },

  softDelete(id: string): void {
    const now = new Date().toISOString()
    getDb().prepare('UPDATE session_shares SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    log.info({ shareId: id }, 'session share soft-deleted')
  },

  softDeleteBySession(sessionId: string): number {
    const now = new Date().toISOString()
    const result = getDb()
      .prepare('UPDATE session_shares SET deleted_at = ?, updated_at = ? WHERE session_id = ? AND deleted_at IS NULL')
      .run(now, now, sessionId)
    log.info({ sessionId, deletedCount: result.changes }, 'session shares cascaded on session delete')
    return result.changes
  },

  incrementVisit(token: string): void {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE session_shares
      SET visit_count = visit_count + 1, last_visited_at = ?
      WHERE share_token = ? AND deleted_at IS NULL
    `).run(now, token)
  },

  isEffective(token: string): boolean {
    const row = sessionShareStore.getByToken(token)
    if (!row) return false
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false
    return true
  },
}
