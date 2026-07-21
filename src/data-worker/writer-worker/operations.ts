import type Database from 'better-sqlite3'
import type { WorkerErrorCode } from '../protocol.js'
import type {
  SessionEventWriteInput,
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

export class WriterOperationError extends Error {
  readonly code: WorkerErrorCode

  constructor(code: WorkerErrorCode, message: string) {
    super(message)
    this.name = 'WriterOperationError'
    this.code = code
  }
}

export function executeWriteBatches(db: SqliteDatabase, batches: WriteBatch[]): WriteBatchResult[] {
  const execute = db.transaction((items: WriteBatch[]) => items.map((batch) => commitBatch(db, batch)))
  return execute.immediate(batches)
}

function commitBatch(db: SqliteDatabase, batch: WriteBatch): WriteBatchResult {
  validateBatch(batch)
  const existing = db.prepare<[string], BatchCommitRow>(
    'SELECT * FROM writer_batch_commits WHERE batch_id = ?',
  ).get(batch.batchId)
  if (existing) {
    return {
      batchId: existing.batch_id,
      duplicate: true,
      committedAt: existing.committed_at,
      results: [],
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
  return { batchId: batch.batchId, duplicate: false, committedAt, results }
}

function validateSessionOrder(db: SqliteDatabase, batch: WriteBatch): void {
  if (!batch.sessionId || !batch.streamGeneration) return
  const latest = db.prepare<[string], BatchCommitRow>(`
    SELECT * FROM writer_batch_commits
    WHERE session_id = ?
    ORDER BY rowid DESC
    LIMIT 1
  `).get(batch.sessionId)
  if (!latest || latest.stream_generation !== batch.streamGeneration) return
  const lastSequence = latest.last_sequence
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
      const result = db.prepare(
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
  }
}

export function readSessionWriteCursor(db: SqliteDatabase, sessionId: string): SessionWriteCursor {
  const event = db.prepare<[string], { sequence: number | null }>(
    'SELECT MAX(sequence) AS sequence FROM session_events WHERE session_id = ?',
  ).get(sessionId)
  const batch = db.prepare<[string], { last_sequence: number | null }>(`
    SELECT last_sequence FROM writer_batch_commits
    WHERE session_id = ? ORDER BY rowid DESC LIMIT 1
  `).get(sessionId)
  return { sequence: Math.max(event?.sequence ?? 0, batch?.last_sequence ?? 0) }
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

function appendSessionEvent(
  db: SqliteDatabase,
  input: SessionEventWriteInput,
): SessionEventWriteResult {
  const previous = db.prepare<[string], { sequence: number | null }>(
    'SELECT MAX(sequence) AS sequence FROM session_events WHERE session_id = ?',
  ).get(input.sessionId)
  const event: SessionEventWriteResult = {
    id: input.id,
    session_id: input.sessionId,
    agent_id: input.agentId ?? null,
    acp_session_id: input.acpSessionId ?? null,
    message_id: input.messageId ?? null,
    type: input.eventType,
    role: input.role ?? null,
    payload_json: JSON.stringify(input.payload),
    sequence: (previous?.sequence ?? 0) + 1,
    created_at: input.createdAt,
  }
  db.prepare(`
    INSERT INTO session_events (
      id, session_id, agent_id, acp_session_id, message_id,
      type, role, payload_json, sequence, created_at
    ) VALUES (
      @id, @session_id, @agent_id, @acp_session_id, @message_id,
      @type, @role, @payload_json, @sequence, @created_at
    )
  `).run(event)
  return event
}

function validateBatch(batch: WriteBatch): void {
  if (!batch.batchId.trim()) throw new WriterOperationError('BAD_REQUEST', 'batchId is required')
  if (batch.mutations.length === 0) {
    throw new WriterOperationError('BAD_REQUEST', 'Write batch requires at least one mutation')
  }
  const orderingFields = [
    batch.sessionId,
    batch.streamGeneration,
    batch.firstSequence,
    batch.lastSequence,
  ]
  const definedCount = orderingFields.filter((value) => value != null).length
  if (definedCount !== 0 && definedCount !== orderingFields.length) {
    throw new WriterOperationError('BAD_REQUEST', 'Session ordering metadata must be complete')
  }
  if (definedCount === orderingFields.length) {
    if (!Number.isInteger(batch.firstSequence) || !Number.isInteger(batch.lastSequence)) {
      throw new WriterOperationError('BAD_REQUEST', 'Batch sequences must be integers')
    }
    if ((batch.firstSequence ?? -1) < 0 || (batch.lastSequence ?? -1) < (batch.firstSequence ?? 0)) {
      throw new WriterOperationError('BAD_REQUEST', 'Batch sequence range is invalid')
    }
  }
}

function assertMutationSession(batch: WriteBatch, mutation: WriteMutation): void {
  if (!batch.sessionId) return
  let mutationSessionId: string | undefined
  if (mutation.type === 'session.event.append') mutationSessionId = mutation.event.sessionId
  else if (mutation.type === 'session.touch' || mutation.type === 'session.stage.update') {
    mutationSessionId = mutation.sessionId
  } else if (mutation.type === 'outbox.enqueue') mutationSessionId = mutation.event.sessionId
  if (mutationSessionId && mutationSessionId !== batch.sessionId) {
    throw new WriterOperationError(
      'BAD_REQUEST',
      `Mutation session ${mutationSessionId} does not match batch session ${batch.sessionId}`,
    )
  }
}
