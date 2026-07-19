import { existsSync, statSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type {
  DatabaseMaintenanceConfig,
  DatabaseMaintenanceInput,
  DatabaseMaintenanceResult,
} from '../../ports/write-data-port.js'

type SqliteDatabase = ReturnType<typeof Database>

interface CheckpointRow {
  busy: number
  log: number
  checkpointed: number
}

interface DatabaseListRow {
  name: string
  file: string
}

export const DEFAULT_WAL_CHECKPOINT_BYTES = 64 * 1024 * 1024
export const DEFAULT_PUBLISHED_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function maintainWriterDatabase(
  db: SqliteDatabase,
  input: DatabaseMaintenanceInput,
  config: DatabaseMaintenanceConfig = {},
): DatabaseMaintenanceResult {
  const startedAt = performance.now()
  const retentionMs = config.publishedOutboxRetentionMs ?? DEFAULT_PUBLISHED_OUTBOX_RETENTION_MS
  const cutoff = new Date(Date.now() - retentionMs).toISOString()
  const deleted = db
    .prepare(
      `
    DELETE FROM outbox_events
    WHERE published_at IS NOT NULL AND published_at < ?
  `,
    )
    .run(cutoff)

  db.pragma('optimize')
  const walPath = `${mainDatabasePath(db)}-wal`
  const walBytesBefore = fileSize(walPath)
  const threshold = config.walCheckpointBytes ?? DEFAULT_WAL_CHECKPOINT_BYTES
  const checkpointMode = input.force ? 'truncate' : walBytesBefore >= threshold ? 'passive' : 'none'
  const checkpoint =
    checkpointMode === 'none' ? { busy: 0, log: 0, checkpointed: 0 } : runCheckpoint(db, checkpointMode)

  return {
    walBytesBefore,
    walBytesAfter: fileSize(walPath),
    checkpointAttempted: checkpointMode !== 'none',
    checkpointMode,
    checkpointBusyPages: checkpoint.busy,
    checkpointLogPages: checkpoint.log,
    checkpointedPages: checkpoint.checkpointed,
    optimized: true,
    deletedPublishedOutboxRows: deleted.changes,
    elapsedMs: performance.now() - startedAt,
  }
}

function runCheckpoint(db: SqliteDatabase, mode: 'passive' | 'truncate'): CheckpointRow {
  const rows = db.pragma(`wal_checkpoint(${mode.toUpperCase()})`) as CheckpointRow[]
  return rows[0] ?? { busy: 0, log: 0, checkpointed: 0 }
}

function mainDatabasePath(db: SqliteDatabase): string {
  const databases = db.pragma('database_list') as DatabaseListRow[]
  return databases.find((database) => database.name === 'main')?.file ?? ''
}

function fileSize(path: string): number {
  return path && existsSync(path) ? statSync(path).size : 0
}
