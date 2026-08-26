import type Database from 'better-sqlite3'
import type {
  RetentionBatchInput,
  RetentionBatchResult,
  RetentionInspectInput,
  RetentionInspectResult,
} from '../../ports/write-data-port.js'
import { WriterOperationError } from './writer-operation-error.js'

type SqliteDatabase = ReturnType<typeof Database>

const ELIGIBLE_CTE = `
  WITH completed_turns AS (
    SELECT id, session_id,
      COALESCE(completed_at, timestamp) AS completed_at,
      ROW_NUMBER() OVER (
        PARTITION BY session_id
        ORDER BY COALESCE(completed_at, timestamp) DESC, id DESC
      ) AS turn_rank
    FROM messages
    WHERE role = 'agent' AND status = 'completed'
  ), eligible AS (
    SELECT id FROM completed_turns
    WHERE turn_rank > @keepTurns AND completed_at < @cutoff
  )
`

export function inspectRetention(db: SqliteDatabase, input: RetentionInspectInput): RetentionInspectResult {
  validateInspectInput(input)
  const row = db
    .prepare<
      RetentionInspectInput,
      {
        eligible_messages: number
        process_rows: number
        event_rows: number
        estimated_bytes: number
      }
    >(
      `${ELIGIBLE_CTE}, eligible_work AS (
        SELECT eligible.id FROM eligible
        JOIN messages ON messages.id = eligible.id
        WHERE messages.process_item_count <> 0
          OR EXISTS (SELECT 1 FROM turn_process_items WHERE message_id = eligible.id)
          OR EXISTS (SELECT 1 FROM session_events WHERE message_id = eligible.id)
      )
    SELECT
      (SELECT COUNT(*) FROM eligible_work) AS eligible_messages,
      (SELECT COUNT(*) FROM turn_process_items WHERE message_id IN (SELECT id FROM eligible_work)) AS process_rows,
      (SELECT COUNT(*) FROM session_events WHERE message_id IN (SELECT id FROM eligible_work)) AS event_rows,
      COALESCE((
        SELECT SUM(
          LENGTH(CAST(COALESCE(content, '') AS BLOB))
          + LENGTH(CAST(COALESCE(detail_json, '') AS BLOB))
          + LENGTH(CAST(COALESCE(meta_json, '') AS BLOB))
          + LENGTH(CAST(COALESCE(summary, '') AS BLOB))
          + LENGTH(CAST(COALESCE(preview, '') AS BLOB))
        ) FROM turn_process_items WHERE message_id IN (SELECT id FROM eligible_work)
      ), 0) + COALESCE((
        SELECT SUM(LENGTH(CAST(payload_json AS BLOB))) FROM session_events
        WHERE message_id IN (SELECT id FROM eligible_work)
      ), 0) AS estimated_bytes
  `,
    )
    .get(input)
  return {
    eligibleMessages: row?.eligible_messages ?? 0,
    processRows: row?.process_rows ?? 0,
    eventRows: row?.event_rows ?? 0,
    estimatedBytes: row?.estimated_bytes ?? 0,
  }
}

export function runRetentionBatch(db: SqliteDatabase, input: RetentionBatchInput): RetentionBatchResult {
  validateBatchInput(input)
  const startedAt = performance.now()
  const execute = db.transaction(() => {
    const messageId = findCandidateMessage(db, input)
    if (!messageId) return emptyBatch(performance.now() - startedAt)

    const reset = db
      .prepare(
        `
      UPDATE messages SET process_item_count = 0
      WHERE id = @messageId
        AND role = 'agent'
        AND status = 'completed'
        AND COALESCE(completed_at, timestamp) < @cutoff
    `,
      )
      .run({ ...input, messageId })
    if (reset.changes === 0) return emptyBatch(performance.now() - startedAt)

    const process = db
      .prepare(
        `
      DELETE FROM turn_process_items WHERE rowid IN (
        SELECT rowid FROM turn_process_items WHERE message_id = @messageId LIMIT @batchRows
      )
    `,
      )
      .run({ messageId, batchRows: input.batchRows })
    const processRemaining = hasRows(db, 'turn_process_items', messageId)
    const eventBudget = processRemaining ? 0 : input.batchRows - process.changes
    const events =
      eventBudget > 0
        ? db
            .prepare(
              `
          DELETE FROM session_events WHERE rowid IN (
            SELECT rowid FROM session_events WHERE message_id = @messageId LIMIT @eventBudget
          )
        `,
            )
            .run({ messageId, eventBudget })
        : { changes: 0 }

    return {
      messageId,
      resetProcessItemCount: true,
      deletedProcessRows: process.changes,
      deletedEventRows: events.changes,
      // An extra empty batch avoids repeating the full per-Session rank scan in this transaction.
      hasMore: true,
      elapsedMs: performance.now() - startedAt,
    }
  })
  return execute()
}

function findCandidateMessage(db: SqliteDatabase, input: RetentionInspectInput): string | null {
  const row = db
    .prepare<RetentionInspectInput, { id: string }>(
      `${ELIGIBLE_CTE}
    SELECT eligible.id FROM eligible
    JOIN messages ON messages.id = eligible.id
    WHERE messages.process_item_count <> 0
      OR EXISTS (SELECT 1 FROM turn_process_items WHERE message_id = eligible.id)
      OR EXISTS (SELECT 1 FROM session_events WHERE message_id = eligible.id)
    ORDER BY eligible.id
    LIMIT 1
  `,
    )
    .get(input)
  return row?.id ?? null
}

function hasRows(db: SqliteDatabase, table: 'turn_process_items', messageId: string): boolean {
  const row = db
    .prepare<
      [{ messageId: string }],
      { found: number }
    >(`SELECT 1 AS found FROM ${table} WHERE message_id = @messageId LIMIT 1`)
    .get({ messageId })
  return row?.found === 1
}

function emptyBatch(elapsedMs: number): RetentionBatchResult {
  return {
    messageId: null,
    resetProcessItemCount: false,
    deletedProcessRows: 0,
    deletedEventRows: 0,
    hasMore: false,
    elapsedMs,
  }
}

function validateInspectInput(input: RetentionInspectInput): void {
  if (!Number.isInteger(input.keepTurns) || input.keepTurns < 1) {
    throw new WriterOperationError('BAD_REQUEST', 'Retention keepTurns must be a positive integer')
  }
  if (!Number.isFinite(Date.parse(input.cutoff))) {
    throw new WriterOperationError('BAD_REQUEST', 'Retention cutoff must be an ISO timestamp')
  }
}

function validateBatchInput(input: RetentionBatchInput): void {
  validateInspectInput(input)
  if (!Number.isInteger(input.batchRows) || input.batchRows < 1 || input.batchRows > 500) {
    throw new WriterOperationError('BAD_REQUEST', 'Retention batchRows must be between 1 and 500')
  }
}
