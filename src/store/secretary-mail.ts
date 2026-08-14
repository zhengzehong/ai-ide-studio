import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

export interface SecretaryAttachment {
  path: string
  title?: string
  kind?: string
}

export interface SecretaryThreadData {
  id: string
  secretaryId: string
  threadKey: string
  subject: string
  summary: string
  kind: string
  priority: string
  needsAction: boolean
  unread: boolean
  status: string
  bodyMarkdown: string
  sourceRefs: string[]
  attachments: SecretaryAttachment[]
  createdAt: string
  updatedAt: string
}

export interface UpsertSecretaryThreadInput {
  secretaryId: string
  threadKey: string
  subject: string
  summary?: string
  kind?: string
  priority?: string
  needsAction?: boolean
  bodyMarkdown: string
  sourceRefs?: string[]
  attachments?: SecretaryAttachment[]
}

interface ThreadRow {
  id: string
  secretary_id: string
  thread_key: string
  subject: string
  summary: string
  kind: string
  priority: string
  needs_action: number
  unread: number
  status: string
  body_markdown: string
  source_refs_json: string
  attachments_json: string
  created_at: string
  updated_at: string
}

export const secretaryMailStore = {
  upsert(input: UpsertSecretaryThreadInput): SecretaryThreadData {
    const current = getDb().prepare<[string, string], ThreadRow>(
      'SELECT * FROM secretary_threads WHERE secretary_id = ? AND thread_key = ?',
    ).get(input.secretaryId, input.threadKey)
    const now = new Date().toISOString()
    const row: ThreadRow = {
      id: current?.id ?? `secretary-thread-${randomUUID().slice(0, 8)}`,
      secretary_id: input.secretaryId,
      thread_key: input.threadKey,
      subject: input.subject,
      summary: input.summary ?? current?.summary ?? '',
      kind: input.kind ?? current?.kind ?? 'result',
      priority: input.priority ?? current?.priority ?? 'normal',
      needs_action: input.needsAction === undefined ? current?.needs_action ?? 0 : input.needsAction ? 1 : 0,
      unread: 1,
      status: current?.status ?? 'open',
      body_markdown: input.bodyMarkdown,
      source_refs_json: JSON.stringify(input.sourceRefs ?? parseStringArray(current?.source_refs_json)),
      attachments_json: JSON.stringify(input.attachments ?? parseAttachments(current?.attachments_json)),
      created_at: current?.created_at ?? now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO secretary_threads (
        id, secretary_id, thread_key, subject, summary, kind, priority, needs_action,
        unread, status, body_markdown, source_refs_json, attachments_json, created_at, updated_at
      ) VALUES (
        @id, @secretary_id, @thread_key, @subject, @summary, @kind, @priority, @needs_action,
        @unread, @status, @body_markdown, @source_refs_json, @attachments_json, @created_at, @updated_at
      )
      ON CONFLICT(secretary_id, thread_key) DO UPDATE SET
        subject = excluded.subject, summary = excluded.summary, kind = excluded.kind,
        priority = excluded.priority, needs_action = excluded.needs_action, unread = 1,
        body_markdown = excluded.body_markdown, source_refs_json = excluded.source_refs_json,
        attachments_json = excluded.attachments_json, updated_at = excluded.updated_at
    `).run(row)
    return toData(getDb().prepare<[string], ThreadRow>('SELECT * FROM secretary_threads WHERE id = ?').get(row.id)!)
  },

  list(secretaryId: string, options: { unreadOnly?: boolean; limit?: number } = {}): SecretaryThreadData[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const unread = options.unreadOnly ? ' AND unread = 1' : ''
    return getDb().prepare<[string, number], ThreadRow>(`
      SELECT * FROM secretary_threads
      WHERE secretary_id = ? AND status != 'archived'${unread}
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `).all(secretaryId, limit).map(toData)
  },

  get(id: string): SecretaryThreadData | undefined {
    const row = getDb().prepare<[string], ThreadRow>('SELECT * FROM secretary_threads WHERE id = ?').get(id)
    return row ? toData(row) : undefined
  },

  markRead(id: string): SecretaryThreadData | undefined {
    getDb().prepare('UPDATE secretary_threads SET unread = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    return this.get(id)
  },

  archive(id: string): SecretaryThreadData | undefined {
    getDb().prepare(`UPDATE secretary_threads SET status = 'archived', unread = 0, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id)
    return this.get(id)
  },

  appendEntry(threadId: string, role: 'user' | 'secretary' | 'system', bodyMarkdown: string): void {
    getDb().prepare(`
      INSERT INTO secretary_entries (id, thread_id, role, body_markdown, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(`secretary-entry-${randomUUID().slice(0, 8)}`, threadId, role, bodyMarkdown, new Date().toISOString())
  },
}

function toData(row: ThreadRow): SecretaryThreadData {
  return {
    id: row.id,
    secretaryId: row.secretary_id,
    threadKey: row.thread_key,
    subject: row.subject,
    summary: row.summary,
    kind: row.kind,
    priority: row.priority,
    needsAction: row.needs_action === 1,
    unread: row.unread === 1,
    status: row.status,
    bodyMarkdown: row.body_markdown,
    sourceRefs: parseStringArray(row.source_refs_json),
    attachments: parseAttachments(row.attachments_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 50) : []
  } catch {
    return []
  }
}

function parseAttachments(raw: string | null | undefined): SecretaryAttachment[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.flatMap((item): SecretaryAttachment[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const record = item as Record<string, unknown>
      if (typeof record.path !== 'string' || !record.path.trim()) return []
      return [{
        path: record.path,
        ...(typeof record.title === 'string' ? { title: record.title } : {}),
        ...(typeof record.kind === 'string' ? { kind: record.kind } : {}),
      }]
    }).slice(0, 20)
  } catch {
    return []
  }
}
