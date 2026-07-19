import type Database from 'better-sqlite3'
import type { WorkerErrorCode } from '../protocol.js'
import type {
  SessionEventWriteInput,
  SessionEventWriteResult,
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
  return execute(batches)
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
  const results = batch.mutations.map((mutation) => executeMutation(db, batch, mutation))
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
        mutation.event.version,
        JSON.stringify(mutation.event.payload),
        mutation.event.createdAt,
      )
      return { type: mutation.type, id: mutation.event.id }
  }
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
