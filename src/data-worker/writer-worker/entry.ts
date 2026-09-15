import Database from 'better-sqlite3'
import { parentPort, workerData } from 'node:worker_threads'
import type {
  DatabaseMaintenanceResult,
  RuntimeCommandEnqueueResult,
  RuntimeCommandInput,
  RuntimeCommandRecoveryQuery,
  RuntimeCommandRecord,
  RuntimeCommandUpdate,
  RetentionBatchInput,
  RetentionBatchResult,
  RetentionInspectInput,
  RetentionInspectResult,
  SessionWriteCursor,
  WriteBatch,
  WriteBatchResult,
} from '../../ports/write-data-port.js'
import type { WorkerErrorCode, WorkerMetrics, WorkerRequest, WorkerResponse, WritePriority } from '../protocol.js'
import { WriterScheduler, type WriterSchedulerItem } from './scheduler.js'
import {
  enqueueRuntimeCommand,
  executeWriteBatches,
  listRecoverableRuntimeCommands,
  readSessionWriteCursor,
  updateRuntimeCommand,
} from './operations.js'
import { maintainWriterDatabase } from './maintenance.js'
import { WriterOperationError } from './writer-operation-error.js'
import { inspectRetention, runRetentionBatch } from './retention.js'

interface WriterWorkerData {
  dbPath: string
  walCheckpointBytes?: number
  publishedOutboxRetentionMs?: number
  batchCommitRetentionMs?: number
  batchCommitPruneRows?: number
}

interface WriterWork {
  request: WorkerRequest
  batch?: WriteBatch
  retention?: { operation: 'writer.retention.inspect' | 'writer.retention.batch'; input: unknown }
  queueDepth: number
  startedAt?: number
  executionMs?: number
}

const port = requireParentPort(parentPort)
const config = parseWorkerData(workerData)
/** maintenance 等写通道空闲:队列空且最近 1s 无批次执行才开跑,最多等 15s 后照常执行。 */
const MAINTENANCE_QUIET_MS = 1_000
const MAINTENANCE_MAX_WAIT_MS = 15_000
const MAINTENANCE_POLL_MS = 100
const db = new Database(config.dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

const scheduler = new WriterScheduler<WriterWork, WriteBatchResult | RetentionInspectResult | RetentionBatchResult>({
  executeBatch: async (items) => executeScheduledBatch(items),
})

port.postMessage({ kind: 'ready', worker: 'writer' })

port.on('message', (message: unknown) => {
  if (!isWriteRequest(message)) return
  if (message.operation === 'writer.retention.inspect' || message.operation === 'writer.retention.batch') {
    const work: WriterWork = {
      request: message,
      retention: { operation: message.operation, input: message.payload },
      queueDepth: scheduler.pendingCount + 1,
    }
    void scheduler.enqueue({
      value: work,
      priority: 'background',
      mutationCount: Number.MAX_SAFE_INTEGER,
      payloadBytes: message.payloadBytes,
    }).then(
      (result) => port.postMessage(resultResponse(work, result)),
      (error) => port.postMessage(errorResponse(message, errorCode(error), errorMessage(error), work)),
    )
    return
  }
  if (message.operation !== 'writer.commit') {
    void executeControlRequest(message)
    return
  }
  const batch = asWriteBatch(message.payload)
  const work: WriterWork = {
    request: message,
    batch,
    queueDepth: scheduler.pendingCount + 1,
  }
  void scheduler
    .enqueue({
      value: work,
      priority: batch.priority,
      sessionId: batch.sessionId,
      mutationCount: batch.mutations.length,
      payloadBytes: message.payloadBytes,
    })
    .then(
      (result) => port.postMessage(resultResponse(work, result)),
      (error) => port.postMessage(errorResponse(message, errorCode(error), errorMessage(error), work)),
    )
})

async function executeControlRequest(request: WorkerRequest): Promise<void> {
  const startedAt = performance.now()
  try {
    // 读己之写:cursor 需要看到刚刚提交的批次,所以先冲刷在途队列。
    // command.* 只读写 runtime_commands(与批次无交集),不再无条件全局 drain —— 旧实现让
    // 每个控制请求都等整个写队列排空,是"控制面被写通道拖住"的来源之一。
    if (request.operation === 'writer.cursor') {
      await scheduler.drain()
    }
    let result:
      | SessionWriteCursor
      | RuntimeCommandEnqueueResult
      | RuntimeCommandRecord[]
      | RuntimeCommandRecord
      | DatabaseMaintenanceResult
    let waitedMs = 0
    if (request.operation === 'writer.cursor') {
      result = readSessionWriteCursor(db, asSessionCursorRequest(request.payload))
    } else if (request.operation === 'writer.command.enqueue') {
      result = enqueueRuntimeCommand(db, request.payload as RuntimeCommandInput)
    } else if (request.operation === 'writer.command.recover') {
      result = listRecoverableRuntimeCommands(db, asRecoveryQuery(request.payload))
    } else if (request.operation === 'writer.command.update') {
      result = updateRuntimeCommand(db, request.payload as RuntimeCommandUpdate)
    } else if (request.operation === 'writer.maintain') {
      // maintenance 全同步执行期间会独占 worker 线程(批次只能排队),因此等写通道空闲再跑;
      // 但必须带最长等待,避免持续流量下"永远跑不上"。
      waitedMs = await waitForIdleWriteChannel(request)
      result = maintainWriterDatabase(db, asMaintenanceInput(request.payload), config)
    } else {
      throw new WriterOperationError('BAD_REQUEST', `Unknown write operation: ${request.operation}`)
    }
    port.postMessage(directResultResponse(request, result, performance.now() - startedAt - waitedMs, waitedMs))
  } catch (error) {
    port.postMessage(errorResponse(request, errorCode(error), errorMessage(error)))
  }
}

/**
 * 等"队列为空且最近 quietMs 无批次执行";超过 maxWaitMs 就照常执行。
 * 返回实际等待时长(ms),用于把等待从 executionMs 里剥离,避免污染延迟归因。
 */
async function waitForIdleWriteChannel(request: WorkerRequest): Promise<number> {
  if (asMaintenanceInput(request.payload).force) return 0
  const waitStartedAt = performance.now()
  const deadline = waitStartedAt + MAINTENANCE_MAX_WAIT_MS
  while (performance.now() < deadline) {
    const idleForMs = Date.now() - scheduler.lastBatchActivityAt
    if (scheduler.pendingCount === 0 && idleForMs >= MAINTENANCE_QUIET_MS) break
    await delay(MAINTENANCE_POLL_MS)
  }
  return performance.now() - waitStartedAt
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

process.once('exit', () => db.close())

function executeScheduledBatch(
  items: WriterSchedulerItem<WriterWork>[],
): Array<WriteBatchResult | RetentionInspectResult | RetentionBatchResult> {
  const startedAt = Date.now()
  const executionStarted = performance.now()
  for (const item of items) item.value.startedAt = startedAt
  try {
    const retention = items[0]?.value.retention
    if (retention) {
      if (items.length !== 1) throw new Error('Retention work must execute alone')
      return [retention.operation === 'writer.retention.inspect'
        ? inspectRetention(db, retention.input as RetentionInspectInput)
        : runRetentionBatch(db, retention.input as RetentionBatchInput)]
    }
    return executeWriteBatches(
      db,
      items.map((item) => {
        if (!item.value.batch) throw new Error('Writer commit work is missing its batch')
        return item.value.batch
      }),
    )
  } finally {
    const executionMs = performance.now() - executionStarted
    for (const item of items) item.value.executionMs = executionMs
  }
}

function resultResponse(work: WriterWork, result: unknown): WorkerResponse {
  return {
    kind: 'result',
    requestId: work.request.requestId,
    result,
    metrics: metrics(work),
  }
}

function directResultResponse<TResult>(
  request: WorkerRequest,
  result: TResult,
  executionMs: number,
  queueWaitMs = 0,
): WorkerResponse {
  return {
    kind: 'result',
    requestId: request.requestId,
    result,
    metrics: {
      queueDepth: 0,
      queueWaitMs,
      executionMs,
      totalMs: Math.max(0, Date.now() - request.enqueuedAt),
      payloadBytes: request.payloadBytes,
    },
  }
}

function asRecoveryQuery(value: unknown): RuntimeCommandRecoveryQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WriterOperationError('BAD_REQUEST', 'Runtime command recovery payload must be an object')
  }
  const record = value as Record<string, unknown>
  const limit = record.limit
  if (!Number.isInteger(limit)) throw new WriterOperationError('BAD_REQUEST', 'Recovery limit must be an integer')
  if (record.after === undefined) return { limit: limit as number }
  if (!record.after || typeof record.after !== 'object' || Array.isArray(record.after)) {
    throw new WriterOperationError('BAD_REQUEST', 'Recovery cursor must be an object')
  }
  const after = record.after as Record<string, unknown>
  if (typeof after.createdAt !== 'string' || typeof after.commandId !== 'string') {
    throw new WriterOperationError('BAD_REQUEST', 'Recovery cursor requires createdAt and commandId')
  }
  return {
    limit: limit as number,
    after: { createdAt: after.createdAt, commandId: after.commandId },
  }
}

function errorResponse(
  request: WorkerRequest,
  code: WorkerErrorCode,
  message: string,
  work?: WriterWork,
): WorkerResponse {
  return {
    kind: 'error',
    requestId: request.requestId,
    error: { code, message },
    metrics: work ? metrics(work) : emptyMetrics(request),
  }
}

function metrics(work: WriterWork): WorkerMetrics {
  const startedAt = work.startedAt ?? Date.now()
  return {
    queueDepth: work.queueDepth,
    queueWaitMs: Math.max(0, startedAt - work.request.enqueuedAt),
    executionMs: work.executionMs ?? 0,
    totalMs: Math.max(0, Date.now() - work.request.enqueuedAt),
    payloadBytes: work.request.payloadBytes,
  }
}

function emptyMetrics(request: WorkerRequest): WorkerMetrics {
  return {
    queueDepth: 0,
    queueWaitMs: 0,
    executionMs: 0,
    totalMs: Math.max(0, Date.now() - request.enqueuedAt),
    payloadBytes: request.payloadBytes,
  }
}

function isWriteRequest(value: unknown): value is WorkerRequest & { priority: WritePriority } {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<WorkerRequest>
  return (
    request.kind === 'request' &&
    typeof request.requestId === 'string' &&
    typeof request.operation === 'string' &&
    (request.priority === 'critical' || request.priority === 'interactive' || request.priority === 'background')
  )
}

function asWriteBatch(value: unknown): WriteBatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WriterOperationError('BAD_REQUEST', 'Write batch payload must be an object')
  }
  const batch = value as Partial<WriteBatch>
  if (typeof batch.batchId !== 'string' || !Array.isArray(batch.mutations)) {
    throw new WriterOperationError('BAD_REQUEST', 'Write batch requires batchId and mutations')
  }
  return batch as WriteBatch
}

function asSessionCursorRequest(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WriterOperationError('BAD_REQUEST', 'Writer cursor payload must be an object')
  }
  const sessionId = (value as Record<string, unknown>).sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new WriterOperationError('BAD_REQUEST', 'Writer cursor requires sessionId')
  }
  return sessionId
}

function asMaintenanceInput(value: unknown): { force: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WriterOperationError('BAD_REQUEST', 'Writer maintenance payload must be an object')
  }
  const force = (value as Record<string, unknown>).force
  if (typeof force !== 'boolean') {
    throw new WriterOperationError('BAD_REQUEST', 'Writer maintenance requires force')
  }
  return { force }
}

function errorCode(error: unknown): WorkerErrorCode {
  if (error instanceof WriterOperationError) return error.code
  const sqliteCode = errorCodeValue(error)
  if (isSqliteLockCode(sqliteCode)) return sqliteCode
  return 'SQLITE_ERROR'
}

function errorCodeValue(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function isSqliteLockCode(code: string | undefined): code is Extract<
  WorkerErrorCode,
  'SQLITE_BUSY' | 'SQLITE_BUSY_SNAPSHOT' | 'SQLITE_LOCKED' | 'SQLITE_LOCKED_SHAREDCACHE'
> {
  return code === 'SQLITE_BUSY'
    || code === 'SQLITE_BUSY_SNAPSHOT'
    || code === 'SQLITE_LOCKED'
    || code === 'SQLITE_LOCKED_SHAREDCACHE'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseWorkerData(value: unknown): WriterWorkerData {
  if (!value || typeof value !== 'object') throw new Error('Writer Worker data is required')
  const data = value as Record<string, unknown>
  if (typeof data.dbPath !== 'string' || data.dbPath.length === 0) {
    throw new Error('Writer Worker dbPath is required')
  }
  return {
    dbPath: data.dbPath,
    walCheckpointBytes: optionalNonNegativeNumber(data.walCheckpointBytes, 'walCheckpointBytes'),
    publishedOutboxRetentionMs: optionalNonNegativeNumber(
      data.publishedOutboxRetentionMs,
      'publishedOutboxRetentionMs',
    ),
    batchCommitRetentionMs: optionalNonNegativeNumber(data.batchCommitRetentionMs, 'batchCommitRetentionMs'),
    batchCommitPruneRows: optionalNonNegativeNumber(data.batchCommitPruneRows, 'batchCommitPruneRows'),
  }
}

function optionalNonNegativeNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || (value as number) < 0) {
    throw new Error(`Writer Worker ${name} must be a non-negative number`)
  }
  return value as number
}

function requireParentPort(value: typeof parentPort): NonNullable<typeof parentPort> {
  if (!value) throw new Error('Writer Worker requires a parent MessagePort')
  return value
}
