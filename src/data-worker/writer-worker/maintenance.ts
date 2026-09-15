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
/**
 * writer_batch_commits 是"批次幂等账本":batchId 去重只需覆盖重试窗口
 * (单批最多 3 次尝试 × 10s 客户端超时 ≈ 30s,加迟到响应 TTL 60s,分钟级足够);
 * 会话内顺序守卫改由 writer worker 内存 head map 承担。7 天保留窗口留出 4 个数量级余量,
 * 同时避免该表随库无限增长(线上已 504 万行)。
 */
export const DEFAULT_BATCH_COMMIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** 单次 maintenance 的清理/删除上限:保证 maintenance 可预期地短,不长时间占住写通道。 */
export const DEFAULT_BATCH_COMMIT_PRUNE_ROWS = 5_000
export const DEFAULT_OUTBOX_DELETE_ROWS = 20_000
/** 限制 PRAGMA optimize 触发的 ANALYZE 规模(默认可达全表,9GB 库上可能长时间占锁)。 */
export const DEFAULT_OPTIMIZE_ANALYSIS_LIMIT = 4_000
const DELETE_BATCH_ROWS = 1_000
const MAX_PRUNE_PAGES = 100

export function maintainWriterDatabase(
  db: SqliteDatabase,
  input: DatabaseMaintenanceInput,
  config: DatabaseMaintenanceConfig = {},
): DatabaseMaintenanceResult {
  const startedAt = performance.now()
  const phasesMs = { outboxDeleteMs: 0, batchCommitPruneMs: 0, optimizeMs: 0, checkpointMs: 0 }

  const outboxStartedAt = performance.now()
  const deletedPublishedOutboxRows = deletePublishedOutboxRows(db, config)
  phasesMs.outboxDeleteMs = roundedMs(performance.now() - outboxStartedAt)

  const pruneStartedAt = performance.now()
  const prune = pruneBatchCommitRows(db, config)
  phasesMs.batchCommitPruneMs = roundedMs(performance.now() - pruneStartedAt)

  const optimizeStartedAt = performance.now()
  optimizeDatabase(db, config)
  phasesMs.optimizeMs = roundedMs(performance.now() - optimizeStartedAt)

  const walPath = `${mainDatabasePath(db)}-wal`
  const walBytesBefore = fileSize(walPath)
  const threshold = config.walCheckpointBytes ?? DEFAULT_WAL_CHECKPOINT_BYTES
  const checkpointMode = input.force ? 'truncate' : walBytesBefore >= threshold ? 'passive' : 'none'
  const checkpointStartedAt = performance.now()
  const checkpoint =
    checkpointMode === 'none' ? { busy: 0, log: 0, checkpointed: 0 } : runCheckpoint(db, checkpointMode)
  phasesMs.checkpointMs = roundedMs(performance.now() - checkpointStartedAt)

  return {
    walBytesBefore,
    walBytesAfter: fileSize(walPath),
    checkpointAttempted: checkpointMode !== 'none',
    checkpointMode,
    checkpointBusyPages: checkpoint.busy,
    checkpointLogPages: checkpoint.log,
    checkpointedPages: checkpoint.checkpointed,
    optimized: true,
    deletedPublishedOutboxRows,
    deletedBatchCommitRows: prune.deletedRows,
    batchCommitPruneExhausted: prune.exhausted,
    phasesMs,
    elapsedMs: performance.now() - startedAt,
  }
}

/** 分页删除已发布且过期的 outbox 行;超过上限留给下一轮,避免单次事务过大。 */
function deletePublishedOutboxRows(db: SqliteDatabase, config: DatabaseMaintenanceConfig): number {
  const retentionMs = config.publishedOutboxRetentionMs ?? DEFAULT_PUBLISHED_OUTBOX_RETENTION_MS
  const cutoff = new Date(Date.now() - retentionMs).toISOString()
  const maxRows = config.outboxDeleteRows ?? DEFAULT_OUTBOX_DELETE_ROWS
  const statement = db.prepare(`
    DELETE FROM outbox_events
    WHERE rowid IN (
      SELECT rowid FROM outbox_events
      WHERE published_at IS NOT NULL AND published_at < ?
      LIMIT ?
    )
  `)
  let deleted = 0
  while (deleted < maxRows) {
    const limit = Math.min(DELETE_BATCH_ROWS, maxRows - deleted)
    const result = statement.run(cutoff, limit)
    deleted += result.changes
    if (result.changes < limit) break
  }
  return deleted
}

/** 按保留窗口分页清理 writer_batch_commits(依赖 idx_writer_batch_commits_committed_at)。 */
function pruneBatchCommitRows(
  db: SqliteDatabase,
  config: DatabaseMaintenanceConfig,
): { deletedRows: number; exhausted: boolean } {
  const retentionMs = config.batchCommitRetentionMs ?? DEFAULT_BATCH_COMMIT_RETENTION_MS
  if (retentionMs <= 0) return { deletedRows: 0, exhausted: false }
  const cutoff = new Date(Date.now() - retentionMs).toISOString()
  const maxRows = config.batchCommitPruneRows ?? DEFAULT_BATCH_COMMIT_PRUNE_ROWS
  const statement = db.prepare(`
    DELETE FROM writer_batch_commits
    WHERE rowid IN (
      SELECT rowid FROM writer_batch_commits
      WHERE committed_at < ?
      LIMIT ?
    )
  `)
  let deletedRows = 0
  let pages = 0
  while (deletedRows < maxRows && pages < MAX_PRUNE_PAGES) {
    const limit = Math.min(DELETE_BATCH_ROWS, maxRows - deletedRows)
    const result = statement.run(cutoff, limit)
    deletedRows += result.changes
    pages += 1
    if (result.changes < limit) return { deletedRows, exhausted: false }
  }
  return { deletedRows, exhausted: true }
}

/**
 * PRAGMA optimize 会按需在写事务里跑 ANALYZE(9GB/87 表规模下耗时不可控,
 * 历史上有 4 次 writer.maintain 超过 10s 客户端超时的记录)。
 * 这里显式限制 analysis_limit,并在结束后恢复原值。
 */
function optimizeDatabase(db: SqliteDatabase, config: DatabaseMaintenanceConfig): void {
  const analysisLimit = config.optimizeAnalysisLimit ?? DEFAULT_OPTIMIZE_ANALYSIS_LIMIT
  const previous = db.pragma('analysis_limit', { simple: true }) as number
  if (analysisLimit > 0) db.pragma(`analysis_limit = ${analysisLimit}`)
  try {
    db.pragma('optimize')
  } finally {
    if (analysisLimit > 0) db.pragma(`analysis_limit = ${previous}`)
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

function roundedMs(value: number): number {
  return Math.round(value * 1000) / 1000
}
