import type Database from 'better-sqlite3'
import type {
  SessionTurnFinalizeInput,
  SessionTurnFinalizeResult,
  TurnProcessItemWriteInput,
  TurnProcessItemWriteResult,
  TurnProcessTextAppendInput,
} from '../../ports/write-data-port.js'
import { parseFileChangesJson } from '../../store/file-changes.js'
import { QUEUED_PROMPT_STAGE } from '../../store/session-runtime-state.js'

type SqliteDatabase = ReturnType<typeof Database>

// \u4e0e src/store/session-runtime-state.ts \u7684 RUNNING_SESSION_STAGES \u4fdd\u6301\u4e00\u81f4
// (writer worker \u4fa7\u526f\u672c,\u7528\u4e8e\u7ec8\u6001\u65f6\u6e05\u7406\u8fd0\u884c\u4e2d stage)\u3002
const RUNNING_SESSION_STAGES = [
  '\u6b63\u5728\u51c6\u5907 Agent...',
  '\u6b63\u5728\u542f\u52a8 Agent...',
  'Agent \u5df2\u5c31\u7eea',
  '\u6b63\u5728\u6062\u590d\u4f1a\u8bdd...',
  '\u6b63\u5728\u8fde\u63a5\u4f1a\u8bdd...',
  '\u4f1a\u8bdd\u5df2\u8fde\u63a5',
  '\u6b63\u5728\u601d\u8003...',
  QUEUED_PROMPT_STAGE,
] as const

export function upsertTurnProcessItem(
  db: SqliteDatabase,
  input: TurnProcessItemWriteInput,
): TurnProcessItemWriteResult {
  const existing = readTurnProcessItem(db, input.id)
  const now = new Date().toISOString()
  const row: TurnProcessItemWriteResult = {
    id: input.id,
    session_id: input.sessionId,
    message_id: input.messageId,
    sequence: existing?.sequence ?? nextSequence(db, input.messageId),
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

  db.prepare(`
    INSERT INTO turn_process_items (
      id, session_id, message_id, sequence, kind, status, title, summary, preview,
      content, detail_json, meta_json, created_at, updated_at
    ) VALUES (
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

  if (!existing || existing.kind !== row.kind) updateMessageProcessCount(db, input.messageId)
  return row
}

export function appendTurnProcessText(
  db: SqliteDatabase,
  input: TurnProcessTextAppendInput,
): TurnProcessItemWriteResult {
  const existing = readTurnProcessItem(db, input.id)
  const content = `${existing?.content ?? ''}${input.text}`
  return upsertTurnProcessItem(db, {
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
}

export function finalizeSessionTurn(
  db: SqliteDatabase,
  input: SessionTurnFinalizeInput,
): SessionTurnFinalizeResult {
  const fileChangesJson = aggregateFileChanges(db, input.messageId) ?? input.fileChangesJson ?? null
  db.prepare(`
    UPDATE turn_process_items
    SET status = CASE
      WHEN status IS NULL OR status IN ('running', 'pending', 'in_progress') THEN @processStatus
      ELSE status
    END,
    updated_at = @timestamp
    WHERE message_id = @messageId
  `).run(input)

  const processItemCount = processCount(db, input.messageId)
  const messageValues = {
    id: input.messageId,
    session_id: input.sessionId,
    content: input.content,
    status: input.status,
    completed_at: input.timestamp,
    timestamp: input.timestamp,
    decision_json: input.decisionJson ?? null,
    stats_json: input.statsJson ?? null,
    file_changes_json: fileChangesJson,
    presentations_json: input.presentationsJson ?? null,
    process_item_count: processItemCount,
  }
  const updated = db.prepare(`
    UPDATE messages
    SET content = @content,
      thinking = NULL,
      tool_calls_json = NULL,
      decision_json = @decision_json,
      stats_json = @stats_json,
      file_changes_json = @file_changes_json,
      presentations_json = @presentations_json,
      status = @status,
      completed_at = @completed_at,
      process_item_count = @process_item_count,
      timestamp = @timestamp
    WHERE id = @id AND role = 'agent' AND status = 'running'
  `).run(messageValues)
  let applied = updated.changes > 0
  if (!applied && !messageExists(db, input.messageId)) {
    insertTerminalMessage(db, messageValues)
    applied = true
  }

  clearRunningSessionStage(db, input.sessionId, input.timestamp, input.timestamp)

  return { messageId: input.messageId, fileChangesJson, processItemCount, applied }
}

export function clearRunningSessionStage(
  db: SqliteDatabase,
  sessionId: string,
  timestamp: string,
  lastMessageAt?: string,
): number {
  const placeholders = RUNNING_SESSION_STAGES.map(() => '?').join(', ')
  const result = lastMessageAt
    ? db.prepare(`
        UPDATE sessions
        SET stage = CASE WHEN stage IN (${placeholders}) THEN '' ELSE stage END,
          updated_at = ?,
          last_message_at = ?
        WHERE id = ?
      `).run(...RUNNING_SESSION_STAGES, timestamp, lastMessageAt, sessionId)
    : db.prepare(`
        UPDATE sessions
        SET stage = '', updated_at = ?
        WHERE id = ? AND stage IN (${placeholders})
      `).run(timestamp, sessionId, ...RUNNING_SESSION_STAGES)
  return result.changes
}

export function readTurnProcessItem(
  db: SqliteDatabase,
  itemId: string,
): TurnProcessItemWriteResult | undefined {
  return db.prepare<[string], TurnProcessItemWriteResult>(
    'SELECT * FROM turn_process_items WHERE id = ?',
  ).get(itemId)
}

export function reconstructSessionTurnResult(
  db: SqliteDatabase,
  input: SessionTurnFinalizeInput,
): SessionTurnFinalizeResult {
  const message = db.prepare<[string], { file_changes_json: string | null; process_item_count: number; status: string | null }>(`
    SELECT file_changes_json, process_item_count, status FROM messages WHERE id = ?
  `).get(input.messageId)
  return {
    messageId: input.messageId,
    fileChangesJson: message?.file_changes_json ?? null,
    processItemCount: message?.process_item_count ?? processCount(db, input.messageId),
    // 幂等重放批次已提交:终态是否真的在行上(行存在且状态与本批次一致),不能硬编码 true(N1)。
    applied: message !== undefined && message.status === input.status,
  }
}

function insertTerminalMessage(
  db: SqliteDatabase,
  values: {
    id: string
    session_id: string
    content: string
    status: string
    completed_at: string
    timestamp: string
    decision_json: string | null
    stats_json: string | null
    file_changes_json: string | null
    presentations_json: string | null
    process_item_count: number
  },
): void {
  db.prepare(`
    INSERT INTO messages (
      id, session_id, role, content, thinking, tool_calls_json, decision_json,
      attachments_json, file_changes_json, presentations_json, status, started_at,
      completed_at, stats_json, process_item_count, timestamp, sender_id, sender_name, sender_role
    ) VALUES (
      @id, @session_id, 'agent', @content, NULL, NULL, @decision_json,
      NULL, @file_changes_json, @presentations_json, @status, @completed_at,
      @completed_at, @stats_json, @process_item_count, @timestamp, NULL, NULL, 'assistant'
    )
  `).run(values)
}

function messageExists(db: SqliteDatabase, messageId: string): boolean {
  return !!db.prepare<[string], { found: number }>(
    'SELECT 1 AS found FROM messages WHERE id = ? LIMIT 1',
  ).get(messageId)
}

function aggregateFileChanges(db: SqliteDatabase, messageId: string): string | null {
  const rows = db.prepare<[string], { detail_json: string | null }>(`
    SELECT detail_json FROM turn_process_items
    WHERE message_id = ? AND kind = 'file_change' AND detail_json IS NOT NULL
    ORDER BY sequence ASC
  `).all(messageId)
  const files = new Map<string, { path: string; changeType: 'A' | 'M' | 'D' | '?'; addedLines: number; deletedLines: number }>()
  for (const row of rows) {
    const parsed = parseFileChangesJson(row.detail_json)
    for (const file of parsed?.files ?? []) {
      const existing = files.get(file.path)
      if (existing) {
        existing.addedLines += file.addedLines
        existing.deletedLines += file.deletedLines
        existing.changeType = mergeChangeType(existing.changeType, file.changeType)
      } else {
        // 只取摘要字段:detail_json 的文件项还带 segments(diff 正文,可达数 MB),
        // `{...file}` 会把它们整包写进 messages.file_changes_json —— 而列表读取
        // (lightweightMessage / parseFileChangesJson)只认 path/changeType/±行数,
        // 生产实测这一处曾经把 156MB 死数据写进 messages 表(2026-09 修复)。
        files.set(file.path, {
          path: file.path,
          changeType: file.changeType,
          addedLines: file.addedLines,
          deletedLines: file.deletedLines,
        })
      }
    }
  }
  const summaryFiles = Array.from(files.values())
  if (summaryFiles.length === 0) return null
  return JSON.stringify({
    files: summaryFiles,
    totalAdded: summaryFiles.reduce((sum, file) => sum + file.addedLines, 0),
    totalDeleted: summaryFiles.reduce((sum, file) => sum + file.deletedLines, 0),
  })
}

function processCount(db: SqliteDatabase, messageId: string): number {
  return db.prepare<[string], { count: number }>(`
    SELECT COUNT(*) AS count FROM turn_process_items WHERE message_id = ? AND kind <> 'stage'
  `).get(messageId)?.count ?? 0
}

function updateMessageProcessCount(db: SqliteDatabase, messageId: string): void {
  db.prepare(`
    UPDATE messages
    SET process_item_count = (SELECT COUNT(*) FROM turn_process_items WHERE message_id = ? AND kind <> 'stage')
    WHERE id = ?
  `).run(messageId, messageId)
}

function nextSequence(db: SqliteDatabase, messageId: string): number {
  const row = db.prepare<[string], { sequence: number }>(`
    SELECT sequence FROM turn_process_items WHERE message_id = ? ORDER BY sequence DESC LIMIT 1
  `).get(messageId)
  return (row?.sequence ?? 0) + 1
}

function summarizeText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact
}

function titleForTextKind(kind: TurnProcessTextAppendInput['kind']): string {
  if (kind === 'thinking') return '\u601d\u8003\u8fc7\u7a0b'
  if (kind === 'stage') return '\u72b6\u6001'
  if (kind === 'error') return '\u9519\u8bef'
  return '\u4e2d\u95f4\u8bf4\u660e'
}

function mergeChangeType(current: 'A' | 'M' | 'D' | '?', next: 'A' | 'M' | 'D' | '?'): 'A' | 'M' | 'D' | '?' {
  if (current === next) return current
  if (current === 'A' && next === 'M') return 'A'
  if (current === '?' || next === '?') return '?'
  return 'M'
}
