import type Database from 'better-sqlite3'
import type {
  SessionEventWriteInput,
  SessionEventWriteResult,
  WriteBatch,
  WriteMutation,
} from '../../ports/write-data-port.js'
import { WriterOperationError } from './writer-operation-error.js'

type SqliteDatabase = ReturnType<typeof Database>

export function appendSessionEvent(
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

export function validateWriteBatch(batch: WriteBatch): void {
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

export function assertMutationSession(batch: WriteBatch, mutation: WriteMutation): void {
  if (!batch.sessionId) return
  let mutationSessionId: string | undefined
  if (mutation.type === 'session.event.append') mutationSessionId = mutation.event.sessionId
  else if (
    mutation.type === 'session.touch'
    || mutation.type === 'session.stage.update'
    || mutation.type === 'session.stage.clear-running'
    || mutation.type === 'session.title.update-if-empty'
  ) {
    mutationSessionId = mutation.sessionId
  } else if (mutation.type === 'outbox.enqueue') mutationSessionId = mutation.event.sessionId
  else if (mutation.type === 'turn-process.item.upsert' || mutation.type === 'turn-process.text.append') {
    mutationSessionId = mutation.item.sessionId
  } else if (mutation.type === 'session.turn.finalize') mutationSessionId = mutation.input.sessionId
  if (mutationSessionId && mutationSessionId !== batch.sessionId) {
    throw new WriterOperationError(
      'BAD_REQUEST',
      `Mutation session ${mutationSessionId} does not match batch session ${batch.sessionId}`,
    )
  }
}
