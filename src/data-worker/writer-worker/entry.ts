import Database from 'better-sqlite3'
import { parentPort, workerData } from 'node:worker_threads'
import type {
  RuntimeCommandEnqueueResult,
  RuntimeCommandInput,
  RuntimeCommandRecord,
  RuntimeCommandUpdate,
  SessionWriteCursor,
  WriteBatch,
  WriteBatchResult,
} from '../../ports/write-data-port.js'
import type {
  WorkerErrorCode,
  WorkerMetrics,
  WorkerRequest,
  WorkerResponse,
  WritePriority,
} from '../protocol.js'
import { WriterScheduler, type WriterSchedulerItem } from './scheduler.js'
import {
  enqueueRuntimeCommand,
  executeWriteBatches,
  listRecoverableRuntimeCommands,
  readSessionWriteCursor,
  updateRuntimeCommand,
  WriterOperationError,
} from './operations.js'

interface WriterWorkerData {
  dbPath: string
}

interface WriterWork {
  request: WorkerRequest
  batch: WriteBatch
  queueDepth: number
  startedAt?: number
  executionMs?: number
}

const port = requireParentPort(parentPort)
const config = parseWorkerData(workerData)
const db = new Database(config.dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

const scheduler = new WriterScheduler<WriterWork, WriteBatchResult>({
  executeBatch: async (items) => executeScheduledBatch(items),
})

port.postMessage({ kind: 'ready', worker: 'writer' })

port.on('message', (message: unknown) => {
  if (!isWriteRequest(message)) return
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
  void scheduler.enqueue({
    value: work,
    priority: batch.priority,
    sessionId: batch.sessionId,
    mutationCount: batch.mutations.length,
    payloadBytes: message.payloadBytes,
  }).then(
    (result) => port.postMessage(resultResponse(work, result)),
    (error) => port.postMessage(errorResponse(
      message,
      errorCode(error),
      errorMessage(error),
      work,
    )),
  )
})

async function executeControlRequest(request: WorkerRequest): Promise<void> {
  const startedAt = performance.now()
  try {
    await scheduler.drain()
    let result: SessionWriteCursor | RuntimeCommandEnqueueResult | RuntimeCommandRecord[] | RuntimeCommandRecord
    if (request.operation === 'writer.cursor') {
      result = readSessionWriteCursor(db, asSessionCursorRequest(request.payload))
    } else if (request.operation === 'writer.command.enqueue') {
      result = enqueueRuntimeCommand(db, request.payload as RuntimeCommandInput)
    } else if (request.operation === 'writer.command.recover') {
      result = listRecoverableRuntimeCommands(db, asRecoveryLimit(request.payload))
    } else if (request.operation === 'writer.command.update') {
      result = updateRuntimeCommand(db, request.payload as RuntimeCommandUpdate)
    } else {
      throw new WriterOperationError('BAD_REQUEST', `Unknown write operation: ${request.operation}`)
    }
    port.postMessage(directResultResponse(request, result, performance.now() - startedAt))
  } catch (error) {
    port.postMessage(errorResponse(request, errorCode(error), errorMessage(error)))
  }
}

process.once('exit', () => db.close())

function executeScheduledBatch(
  items: WriterSchedulerItem<WriterWork>[],
): WriteBatchResult[] {
  const startedAt = Date.now()
  const executionStarted = performance.now()
  for (const item of items) item.value.startedAt = startedAt
  try {
    return executeWriteBatches(db, items.map((item) => item.value.batch))
  } finally {
    const executionMs = performance.now() - executionStarted
    for (const item of items) item.value.executionMs = executionMs
  }
}

function resultResponse(work: WriterWork, result: WriteBatchResult): WorkerResponse {
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
): WorkerResponse {
  return {
    kind: 'result',
    requestId: request.requestId,
    result,
    metrics: {
      queueDepth: 0,
      queueWaitMs: 0,
      executionMs,
      totalMs: Math.max(0, Date.now() - request.enqueuedAt),
      payloadBytes: request.payloadBytes,
    },
  }
}

function asRecoveryLimit(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WriterOperationError('BAD_REQUEST', 'Runtime command recovery payload must be an object')
  }
  const limit = (value as Record<string, unknown>).limit
  if (!Number.isInteger(limit)) throw new WriterOperationError('BAD_REQUEST', 'Recovery limit must be an integer')
  return limit as number
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
  return request.kind === 'request'
    && typeof request.requestId === 'string'
    && typeof request.operation === 'string'
    && (request.priority === 'critical'
      || request.priority === 'interactive'
      || request.priority === 'background')
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

function errorCode(error: unknown): WorkerErrorCode {
  return error instanceof WriterOperationError ? error.code : 'SQLITE_ERROR'
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
  return { dbPath: data.dbPath }
}

function requireParentPort(value: typeof parentPort): NonNullable<typeof parentPort> {
  if (!value) throw new Error('Writer Worker requires a parent MessagePort')
  return value
}
