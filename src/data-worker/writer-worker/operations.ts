import type Database from 'better-sqlite3'
import type {
  SessionEventWriteResult,
  SessionWriteCursor,
  RuntimeCommandEnqueueResult,
  RuntimeCommandInput,
  RuntimeCommandRecoveryQuery,
  RuntimeCommandRecord,
  RuntimeCommandStatus,
  RuntimeCommandUpdate,
  WriteBatch,
  WriteBatchResult,
  WriteMutation,
  WriteMutationResult,
} from '../../ports/write-data-port.js'
import {
  appendTurnProcessText,
  clearRunningSessionStage,
  finalizeSessionTurn,
  readTurnProcessItem,
  reconstructSessionTurnResult,
  upsertTurnProcessItem,
} from './turn-process-operations.js'
import {
  appendSessionEvent,
  assertMutationSession,
  validateWriteBatch,
} from './write-mutation-helpers.js'
import { WriterOperationError } from './writer-operation-error.js'

type SqliteDatabase = ReturnType<typeof Database>

interface BatchCommitRow {
  batch_id: string
  session_id: string | null
  stream_generation: string | null
  first_sequence: number | null
  last_sequence: number | null
  committed_at: string
}

interface RuntimeCommandRow {
  command_id: string
  idempotency_key: string
  type: RuntimeCommandInput['type']
  session_id: string
  project_id: string | null
  payload_json: string
  status: RuntimeCommandStatus
  attempts: number
  error: string | null
  created_at: string
  updated_at: string
}

interface SessionOrderHead {
  streamGeneration: string
  lastSequence: number | null
}

const SESSION_ORDER_CACHE_LIMIT = 4096
const sessionOrderHeads = new Map<string, SessionOrderHead>()

/** 仅供测试或 worker 重启:清空"每会话最新已提交批次"内存缓存。 */
export function resetSessionOrderCache(): void {
  sessionOrderHeads.clear()
}

export function executeWriteBatches(db: SqliteDatabase, batches: WriteBatch[]): WriteBatchResult[] {
  const execute = db.transaction((items: WriteBatch[]) => items.map((batch) => commitBatch(db, batch)))
  return execute.immediate(batches)
}

function commitBatch(db: SqliteDatabase, batch: WriteBatch): WriteBatchResult {
  validateWriteBatch(batch)
  const existing = db.prepare<[string], BatchCommitRow>(
    'SELECT * FROM writer_batch_commits WHERE batch_id = ?',
  ).get(batch.batchId)
  if (existing) {
    // 重复提交(超时重试命中幂等):用已落库的行校准内存 head,避免缓存落后于库。
    if (batch.sessionId) {
      rememberSessionOrderHead(batch.sessionId, {
        streamGeneration: existing.stream_generation ?? '',
        lastSequence: existing.last_sequence,
      })
    }
    return {
      batchId: existing.batch_id,
      duplicate: true,
      committedAt: existing.committed_at,
      results: reconstructMutationResults(db, batch),
    }
  }

  validateSessionOrder(db, batch)
  const results: WriteMutationResult[] = []
  let appendedEventSequence: number | undefined
  for (const mutation of batch.mutations) {
    const result = executeMutation(db, batch, mutation, appendedEventSequence)
    results.push(result)
    if (result.type === 'session.event.append') appendedEventSequence = result.event.sequence
  }
  const committedAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO writer_batch_commits (
      batch_id, session_id, stream_generation, first_sequence, last_sequence, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    batch.batchId,
    batch.sessionId ?? null,
    batch.streamGeneration ?? null,
    batch.firstSequence ?? null,
    batch.lastSequence ?? null,
    committedAt,
  )
  if (batch.sessionId && batch.streamGeneration) {
    rememberSessionOrderHead(batch.sessionId, {
      streamGeneration: batch.streamGeneration,
      lastSequence: batch.lastSequence ?? null,
    })
  }
  return { batchId: batch.batchId, duplicate: false, committedAt, results }
}

function reconstructMutationResults(db: SqliteDatabase, batch: WriteBatch): WriteMutationResult[] {
  return batch.mutations.map((mutation): WriteMutationResult => {
    if (mutation.type === 'session.event.append') {
      const event = db.prepare<[string], SessionEventWriteResult>(
        'SELECT * FROM session_events WHERE id = ?',
      ).get(mutation.event.id)
      if (!event) throw new WriterOperationError(
        'SQLITE_ERROR', `Committed batch ${batch.batchId} is missing event ${mutation.event.id}`,
      )
      return { type: mutation.type, event }
    }
    if (mutation.type === 'outbox.enqueue') return { type: mutation.type, id: mutation.event.id }
    if (mutation.type === 'turn-process.item.upsert' || mutation.type === 'turn-process.text.append') {
      const item = readTurnProcessItem(db, mutation.item.id)
      if (!item) throw new WriterOperationError(
        'SQLITE_ERROR', `Committed batch ${batch.batchId} is missing process item ${mutation.item.id}`,
      )
      return { type: mutation.type, item }
    }
    if (mutation.type === 'session.turn.finalize') {
      return { type: mutation.type, result: reconstructSessionTurnResult(db, mutation.input) }
    }
    return { type: mutation.type, changes: 0 }
  })
}

/**
 * 内存中的"每会话最新已提交批次"缓存。
 * 老实现对每个批次都跑 `WHERE session_id = ? ORDER BY rowid DESC LIMIT 1`,EXPLAIN 实证其计划为
 * "扫出该会话全部历史行 + 临时 B 树排序":writer_batch_commits 已 500 万行、热门会话 7 万+ 行时
 * 单次 7~31ms(暖缓存)且随库增长持续恶化,并在写事务内占着写锁。
 * writer worker 是该表唯一写入方,因此内存 head 与库一致;未命中时按需 load 一次(仍走 MAX(rowid) 形式)。
 */
function readSessionOrderHead(db: SqliteDatabase, sessionId: string): SessionOrderHead | undefined {
  const row = db.prepare<[string], BatchCommitRow>(`
    SELECT *, MAX(rowid) AS mr
    FROM writer_batch_commits
    WHERE session_id = ?
  `).get(sessionId)
  if (!row) return undefined
  return { streamGeneration: row.stream_generation ?? '', lastSequence: row.last_sequence }
}

function sessionOrderHead(db: SqliteDatabase, sessionId: string): SessionOrderHead | undefined {
  const cached = sessionOrderHeads.get(sessionId)
  if (cached) return cached
  const loaded = readSessionOrderHead(db, sessionId)
  if (loaded) rememberSessionOrderHead(sessionId, loaded)
  return loaded
}

function rememberSessionOrderHead(sessionId: string, head: SessionOrderHead): void {
  if (!sessionOrderHeads.has(sessionId) && sessionOrderHeads.size >= SESSION_ORDER_CACHE_LIMIT) {
    // 按插入序淘汰最旧条目:淘汰只让下一次校验多一次 load,不影响正确性。
    const oldest = sessionOrderHeads.keys().next().value
    if (oldest !== undefined) sessionOrderHeads.delete(oldest)
  }
  sessionOrderHeads.set(sessionId, head)
}

function validateSessionOrder(db: SqliteDatabase, batch: WriteBatch): void {
  if (!batch.sessionId || !batch.streamGeneration) return
  const head = sessionOrderHead(db, batch.sessionId)
  if (!head || head.streamGeneration !== batch.streamGeneration) return
  const lastSequence = head.lastSequence
  if (lastSequence != null && (batch.firstSequence ?? 0) <= lastSequence) {
    throw new WriterOperationError(
      'ORDER_CONFLICT',
      `Batch ${batch.batchId} overlaps committed sequence ${lastSequence} for session ${batch.sessionId}`,
    )
  }
}

function executeMutation(
  db: SqliteDatabase,
  batch: WriteBatch,
  mutation: WriteMutation,
  appendedEventSequence?: number,
): WriteMutationResult {
  assertMutationSession(batch, mutation)
  switch (mutation.type) {
    case 'session.event.append':
      return { type: mutation.type, event: appendSessionEvent(db, mutation.event) }
    case 'message.snapshot.update': {
      const result = db.prepare(`
        UPDATE messages
        SET content = ?, timestamp = ?
        WHERE id = ? AND role = 'agent' AND status = 'running'
      `).run(mutation.content, mutation.timestamp, mutation.messageId)
      return { type: mutation.type, changes: result.changes }
    }
    case 'session.touch': {
      // advanceRead: 发送者自己的消息视为"已读到此刻"。单调守卫(MAX)保证不会把用户手动
      // 标未读的时间戳往回拽;同一执行流内推进,不存在客户端补 markRead 的插队竞态
      const result = mutation.advanceRead
        ? db.prepare(
          'UPDATE sessions SET updated_at = ?, last_message_at = ?, last_read_at = MAX(last_read_at, ?) WHERE id = ?',
        ).run(mutation.timestamp, mutation.timestamp, mutation.timestamp, mutation.sessionId)
        : db.prepare(
          'UPDATE sessions SET updated_at = ?, last_message_at = ? WHERE id = ?',
        ).run(mutation.timestamp, mutation.timestamp, mutation.sessionId)
      return { type: mutation.type, changes: result.changes }
    }
    case 'session.stage.update': {
      const result = db.prepare(
        'UPDATE sessions SET stage = ?, updated_at = ? WHERE id = ?',
      ).run(mutation.stage, mutation.timestamp, mutation.sessionId)
      return { type: mutation.type, changes: result.changes }
    }
    case 'session.stage.clear-running':
      return {
        type: mutation.type,
        changes: clearRunningSessionStage(db, mutation.sessionId, mutation.timestamp),
      }
    case 'session.title.update-if-empty': {
      const result = db.prepare(`
        UPDATE sessions
        SET title = ?, updated_at = ?
        WHERE id = ? AND (title IS NULL OR TRIM(title) = '')
      `).run(mutation.title.trim(), mutation.timestamp, mutation.sessionId)
      return { type: mutation.type, changes: result.changes }
    }
    case 'outbox.enqueue':
      if (mutation.event.version === undefined && appendedEventSequence === undefined) {
        throw new WriterOperationError('BAD_REQUEST', 'Outbox version requires an appended Session event')
      }
      db.prepare(`
        INSERT INTO outbox_events (
          id, topic, aggregate_type, aggregate_id, project_id, session_id,
          version, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mutation.event.id,
        mutation.event.topic,
        mutation.event.aggregateType,
        mutation.event.aggregateId,
        mutation.event.projectId ?? null,
        mutation.event.sessionId ?? null,
        mutation.event.version ?? appendedEventSequence,
        JSON.stringify(mutation.event.payload),
        mutation.event.createdAt,
      )
      return { type: mutation.type, id: mutation.event.id }
    case 'turn-process.item.upsert':
      return { type: mutation.type, item: upsertTurnProcessItem(db, mutation.item) }
    case 'turn-process.text.append':
      return { type: mutation.type, item: appendTurnProcessText(db, mutation.item) }
    case 'session.turn.finalize':
      return { type: mutation.type, result: finalizeSessionTurn(db, mutation.input) }
  }
}

export function readSessionWriteCursor(db: SqliteDatabase, sessionId: string): SessionWriteCursor {
  const event = db.prepare<[string], { sequence: number | null }>(
    'SELECT MAX(sequence) AS sequence FROM session_events WHERE session_id = ?',
  ).get(sessionId)
  // 优先用内存 head(O(1));未命中才按需 load 一次(MAX(rowid) 形式,避免临时 B 树排序)。
  const head = sessionOrderHeads.get(sessionId) ?? readSessionOrderHead(db, sessionId)
  if (head) rememberSessionOrderHead(sessionId, head)
  return { sequence: Math.max(event?.sequence ?? 0, head?.lastSequence ?? 0) }
}

export function enqueueRuntimeCommand(
  db: SqliteDatabase,
  input: RuntimeCommandInput,
): RuntimeCommandEnqueueResult {
  validateRuntimeCommandInput(input)
  const payloadJson = JSON.stringify(input.payload)
  const existing = db.prepare<[string, string], RuntimeCommandRow>(`
    SELECT * FROM runtime_commands WHERE type = ? AND idempotency_key = ?
  `).get(input.type, input.idempotencyKey)
  if (existing) {
    return {
      command: toRuntimeCommandRecord(db, existing),
      duplicate: true,
      conflict: existing.session_id !== input.sessionId || existing.payload_json !== payloadJson,
    }
  }

  db.prepare(`
    INSERT INTO runtime_commands (
      command_id, idempotency_key, type, session_id, project_id, payload_json,
      status, attempts, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', 0, NULL, ?, ?)
  `).run(
    input.commandId,
    input.idempotencyKey,
    input.type,
    input.sessionId,
    input.projectId ?? null,
    payloadJson,
    input.createdAt,
    input.createdAt,
  )
  const inserted = requireRuntimeCommandRow(db, input.commandId)
  return { command: toRuntimeCommandRecord(db, inserted), duplicate: false, conflict: false }
}

export function listRecoverableRuntimeCommands(
  db: SqliteDatabase,
  input: RuntimeCommandRecoveryQuery,
): RuntimeCommandRecord[] {
  const { limit, after } = input
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new WriterOperationError('BAD_REQUEST', 'Runtime command recovery limit must be 1-1000')
  }
  const rows = after
    ? db.prepare<{ createdAt: string; commandId: string; limit: number }, RuntimeCommandRow>(`
        SELECT * FROM runtime_commands
        WHERE status IN ('accepted', 'running')
          AND (created_at > @createdAt OR (created_at = @createdAt AND command_id > @commandId))
        ORDER BY created_at ASC, command_id ASC
        LIMIT @limit
      `).all({ ...after, limit })
    : db.prepare<[number], RuntimeCommandRow>(`
        SELECT * FROM runtime_commands
        WHERE status IN ('accepted', 'running')
        ORDER BY created_at ASC, command_id ASC
        LIMIT ?
      `).all(limit)
  return rows.map((row) => toRuntimeCommandRecord(db, row))
}

export function updateRuntimeCommand(
  db: SqliteDatabase,
  input: RuntimeCommandUpdate,
): RuntimeCommandRecord {
  if (!input.commandId.trim()) throw new WriterOperationError('BAD_REQUEST', 'commandId is required')
  const result = db.prepare(`
    UPDATE runtime_commands
    SET status = ?,
        attempts = attempts + CASE WHEN ? = 'running' THEN 1 ELSE 0 END,
        error = ?,
        updated_at = ?
    WHERE command_id = ?
  `).run(input.status, input.status, input.error ?? null, input.updatedAt, input.commandId)
  if (result.changes !== 1) {
    throw new WriterOperationError('BAD_REQUEST', `Runtime command not found: ${input.commandId}`)
  }
  return toRuntimeCommandRecord(db, requireRuntimeCommandRow(db, input.commandId))
}

function requireRuntimeCommandRow(db: SqliteDatabase, commandId: string): RuntimeCommandRow {
  const row = db.prepare<[string], RuntimeCommandRow>(
    'SELECT * FROM runtime_commands WHERE command_id = ?',
  ).get(commandId)
  if (!row) throw new WriterOperationError('BAD_REQUEST', `Runtime command not found: ${commandId}`)
  return row
}

function toRuntimeCommandRecord(
  db: SqliteDatabase,
  row: RuntimeCommandRow,
): RuntimeCommandRecord {
  const payload = parseJson(row.payload_json)
  const clientMessageId = row.type === 'prompt' && isRecord(payload)
    ? payload.clientMessageId
    : undefined
  const humanMessagePersisted = typeof clientMessageId === 'string'
    && !!db.prepare<[string], { found: number }>(`
      SELECT 1 AS found FROM messages WHERE id = ? AND role = 'human' LIMIT 1
    `).get(clientMessageId)
  return {
    commandId: row.command_id,
    idempotencyKey: row.idempotency_key,
    type: row.type,
    sessionId: row.session_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    payload,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.error ? { error: row.error } : {}),
    humanMessagePersisted,
  }
}

function validateRuntimeCommandInput(input: RuntimeCommandInput): void {
  if (!input.commandId.trim()) throw new WriterOperationError('BAD_REQUEST', 'commandId is required')
  if (!input.idempotencyKey.trim()) throw new WriterOperationError('BAD_REQUEST', 'idempotencyKey is required')
  if (!input.sessionId.trim()) throw new WriterOperationError('BAD_REQUEST', 'sessionId is required')
  if (!input.createdAt.trim()) throw new WriterOperationError('BAD_REQUEST', 'createdAt is required')
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    throw new WriterOperationError('SQLITE_ERROR', `Invalid runtime command payload: ${String(error)}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
