import { createHash, randomUUID } from 'crypto'
import { createChildLogger } from '../core/logger.js'
import type { TurnProcessItemData } from '../types/ws-protocol.js'
import { getDb } from './db.js'
import { parseFileChangesJson } from './file-changes.js'

const log = createChildLogger('store:turn-process')

export type TurnProcessItemKind =
  | 'stage'
  | 'thinking'
  | 'note'
  | 'tool'
  | 'file_change'
  | 'permission'
  | 'elicitation'
  | 'plan'
  | 'usage'
  | 'error'

export interface TurnProcessItemRow {
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
}

interface TurnProcessItemQueryRow extends TurnProcessItemRow {
  has_detail?: 0 | 1
}

export interface UpsertTurnProcessItemInput {
  id?: string
  sessionId: string
  messageId: string
  kind: TurnProcessItemKind
  status?: string | null
  title?: string | null
  summary?: string | null
  preview?: string | null
  content?: string | null
  detail?: unknown
  meta?: unknown
}

export interface AppendTextInput {
  id?: string
  sessionId: string
  messageId: string
  kind: 'thinking' | 'note' | 'stage' | 'error'
  text: string
  title?: string | null
  status?: string | null
  meta?: unknown
}

export function stableProcessItemId(messageId: string, kind: string, key: string): string {
  return `tpi-${createHash('sha1').update(`${messageId}:${kind}:${key}`).digest('hex').slice(0, 18)}`
}

export const turnProcessItemStore = {
  upsert(input: UpsertTurnProcessItemInput): TurnProcessItemRow {
    const existing = input.id ? turnProcessItemStore.get(input.id) : undefined
    const now = new Date().toISOString()
    const row: TurnProcessItemRow = {
      id: input.id ?? `tpi-${randomUUID().slice(0, 8)}`,
      session_id: input.sessionId,
      message_id: input.messageId,
      sequence: existing?.sequence ?? nextSequence(input.messageId),
      kind: input.kind,
      status: input.status ?? existing?.status ?? null,
      title: input.title ?? existing?.title ?? null,
      summary: input.summary ?? existing?.summary ?? null,
      preview: input.preview ?? existing?.preview ?? null,
      content: input.content ?? existing?.content ?? null,
      detail_json: input.detail !== undefined ? JSON.stringify(input.detail) : existing?.detail_json ?? null,
      meta_json: input.meta !== undefined ? JSON.stringify(input.meta) : existing?.meta_json ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }

    getDb().prepare(`
      INSERT INTO turn_process_items (
        id, session_id, message_id, sequence, kind, status, title, summary, preview,
        content, detail_json, meta_json, created_at, updated_at
      )
      VALUES (
        @id, @session_id, @message_id, @sequence, @kind, @status, @title, @summary, @preview,
        @content, @detail_json, @meta_json, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        title = excluded.title,
        summary = excluded.summary,
        preview = excluded.preview,
        content = excluded.content,
        detail_json = excluded.detail_json,
        meta_json = excluded.meta_json,
        updated_at = excluded.updated_at
    `).run(row)

    if (!existing || existing.kind !== row.kind) updateMessageProcessCount(input.messageId)
    log.debug({ sessionId: input.sessionId, messageId: input.messageId, itemId: row.id, kind: row.kind, sequence: row.sequence }, 'turn process item upserted')
    return row
  },

  appendText(input: AppendTextInput): TurnProcessItemRow {
    const existing = input.id ? turnProcessItemStore.get(input.id) : undefined
    const content = existing ? `${existing.content ?? ''}${input.text}` : input.text
    return turnProcessItemStore.upsert({
      id: input.id,
      sessionId: input.sessionId,
      messageId: input.messageId,
      kind: input.kind,
      status: input.status ?? existing?.status ?? 'running',
      title: input.title ?? existing?.title ?? titleForTextKind(input.kind),
      summary: summarizeText(content),
      preview: summarizeText(content),
      content,
      meta: input.meta,
    })
  },

  get(id: string): TurnProcessItemRow | undefined {
    return getDb().prepare<[string], TurnProcessItemRow>('SELECT * FROM turn_process_items WHERE id = ?').get(id)
  },

  getForMessage(messageId: string, id: string): TurnProcessItemRow | undefined {
    return getDb()
      .prepare<{ messageId: string; id: string }, TurnProcessItemRow>('SELECT * FROM turn_process_items WHERE message_id = @messageId AND id = @id')
      .get({ messageId, id })
  },

  list(messageId: string, opts?: { includeDetail?: boolean }): TurnProcessItemData[] {
    const includeDetail = opts?.includeDetail === true
    const columns = includeDetail
      ? '*'
      : `
        id, session_id, message_id, sequence, kind, status, title, summary, preview,
        content, NULL AS detail_json, meta_json, created_at, updated_at,
        CASE WHEN detail_json IS NULL THEN 0 ELSE 1 END AS has_detail
      `
    const rows = getDb().prepare<[string], TurnProcessItemQueryRow>(`
      SELECT ${columns}
      FROM turn_process_items
      WHERE message_id = ?
      ORDER BY sequence ASC
    `).all(messageId)
    return rows.map((row) => toData(row, includeDetail))
  },

  detail(messageId: string, id: string): TurnProcessItemData | undefined {
    const row = turnProcessItemStore.getForMessage(messageId, id)
    return row ? toData(row, true) : undefined
  },

  completeOpen(messageId: string, status: string): void {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE turn_process_items
      SET status = CASE
        WHEN status IS NULL OR status IN ('running', 'pending', 'in_progress') THEN @status
        ELSE status
      END,
      updated_at = @now
      WHERE message_id = @messageId
    `).run({ messageId, status, now })
  },

  aggregateFileChanges(messageId: string): string | null {
    const rows = getDb().prepare<[string], { detail_json: string | null }>(`
      SELECT detail_json
      FROM turn_process_items
      WHERE message_id = ? AND kind = 'file_change' AND detail_json IS NOT NULL
      ORDER BY sequence ASC
    `).all(messageId)
    const files = new Map<string, { path: string; changeType: 'A' | 'M' | 'D' | '?'; addedLines: number; deletedLines: number }>()
    for (const row of rows) {
      const parsed = parseFileChangesJson(row.detail_json)
      if (!parsed?.files.length) continue
      for (const file of parsed.files) {
        const existing = files.get(file.path)
        if (existing) {
          existing.addedLines += file.addedLines
          existing.deletedLines += file.deletedLines
          existing.changeType = mergeChangeType(existing.changeType, file.changeType)
          continue
        }
        files.set(file.path, { ...file })
      }
    }
    const summaryFiles = Array.from(files.values()).map((file) => ({
      path: file.path,
      changeType: file.changeType,
      addedLines: file.addedLines,
      deletedLines: file.deletedLines,
    }))
    if (summaryFiles.length === 0) return null
    return JSON.stringify({
      files: summaryFiles,
      totalAdded: summaryFiles.reduce((sum, file) => sum + file.addedLines, 0),
      totalDeleted: summaryFiles.reduce((sum, file) => sum + file.deletedLines, 0),
    })
  },
}

function nextSequence(messageId: string): number {
  const row = getDb()
    .prepare<[string], { sequence: number }>('SELECT sequence FROM turn_process_items WHERE message_id = ? ORDER BY sequence DESC LIMIT 1')
    .get(messageId)
  return (row?.sequence ?? 0) + 1
}

function updateMessageProcessCount(messageId: string): void {
  getDb().prepare(`
    UPDATE messages
    SET process_item_count = (SELECT COUNT(*) FROM turn_process_items WHERE message_id = ? AND kind <> 'stage')
    WHERE id = ?
  `).run(messageId, messageId)
}

function toData(row: TurnProcessItemQueryRow, includeDetail: boolean): TurnProcessItemData {
  return {
    ...row,
    detail_json: includeDetail ? row.detail_json : undefined,
    has_detail: includeDetail ? !!row.detail_json : row.has_detail === 1,
  }
}

function summarizeText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact
}

function titleForTextKind(kind: AppendTextInput['kind']): string {
  if (kind === 'thinking') return '思考过程'
  if (kind === 'stage') return '状态'
  if (kind === 'error') return '错误'
  return '中间说明'
}

function mergeChangeType(current: 'A' | 'M' | 'D' | '?', next: 'A' | 'M' | 'D' | '?'): 'A' | 'M' | 'D' | '?' {
  if (current === next) return current
  if (current === 'A' && next === 'M') return 'A'
  if (current === '?' || next === '?') return '?'
  return 'M'
}
