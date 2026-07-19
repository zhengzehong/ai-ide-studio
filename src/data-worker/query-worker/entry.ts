import { parentPort, workerData } from 'node:worker_threads'
import { closeDatabase, initReadonlyDatabase } from '../../store/db.js'
import { StablePriorityQueue } from '../priority-queue.js'
import type {
  QueryPriority,
  WorkerErrorCode,
  WorkerMetrics,
  WorkerRequest,
  WorkerResponse,
} from '../protocol.js'
import { executeQueryOperation, QueryOperationError } from './operations.js'

interface QueryWorkerData {
  dbPath: string
  allowDiagnostics?: boolean
}

const port = requireParentPort(parentPort)
const config = parseWorkerData(workerData)
const queue = new StablePriorityQueue<WorkerRequest, QueryPriority>(['interactive', 'background'])
let scheduled = false
let processing = false

initReadonlyDatabase(config.dbPath)
port.postMessage({ kind: 'ready', worker: 'query' })

port.on('message', (message: unknown) => {
  if (!isQueryRequest(message)) return
  queue.enqueue(message, message.priority, {
    now: message.enqueuedAt,
    deadlineAt: message.deadlineAt,
  })
  scheduleProcessing()
})

process.once('exit', () => closeDatabase())

function scheduleProcessing(): void {
  if (scheduled || processing) return
  scheduled = true
  setImmediate(() => {
    scheduled = false
    void processNext()
  })
}

async function processNext(): Promise<void> {
  if (processing) return
  const queued = queue.dequeue(Date.now())
  if (!queued) return
  processing = true
  const request = queued.value
  const startedAt = performance.now()
  if (queued.expired) {
    port.postMessage(errorResponse(
      request,
      'DEADLINE_EXCEEDED',
      `Query deadline exceeded before execution: ${request.operation}`,
      queued.queueWaitMs,
      0,
    ))
  } else {
    try {
      const result = await executeQueryOperation(request.operation, request.payload, {
        allowDiagnostics: config.allowDiagnostics === true,
      })
      const executionMs = performance.now() - startedAt
      const response: WorkerResponse = {
        kind: 'result',
        requestId: request.requestId,
        result,
        metrics: metrics(request, queued.queueWaitMs, executionMs),
      }
      port.postMessage(response)
    } catch (error) {
      const executionMs = performance.now() - startedAt
      const code: WorkerErrorCode = error instanceof QueryOperationError ? error.code : 'SQLITE_ERROR'
      port.postMessage(errorResponse(
        request,
        code,
        errorMessage(error),
        queued.queueWaitMs,
        executionMs,
      ))
    }
  }
  processing = false
  if (queue.size > 0) scheduleProcessing()
}

function metrics(request: WorkerRequest, queueWaitMs: number, executionMs: number): WorkerMetrics {
  return {
    queueDepth: queue.size,
    queueWaitMs,
    executionMs,
    totalMs: Math.max(0, Date.now() - request.enqueuedAt),
    payloadBytes: request.payloadBytes,
  }
}

function errorResponse(
  request: WorkerRequest,
  code: WorkerErrorCode,
  message: string,
  queueWaitMs: number,
  executionMs: number,
): WorkerResponse {
  return {
    kind: 'error',
    requestId: request.requestId,
    error: { code, message },
    metrics: metrics(request, queueWaitMs, executionMs),
  }
}

function isQueryRequest(value: unknown): value is WorkerRequest & { priority: QueryPriority } {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<WorkerRequest>
  return request.kind === 'request'
    && typeof request.requestId === 'string'
    && typeof request.operation === 'string'
    && (request.priority === 'interactive' || request.priority === 'background')
}

function parseWorkerData(value: unknown): QueryWorkerData {
  if (!value || typeof value !== 'object') throw new Error('Query Worker data is required')
  const data = value as Record<string, unknown>
  if (typeof data.dbPath !== 'string' || data.dbPath.length === 0) {
    throw new Error('Query Worker dbPath is required')
  }
  return { dbPath: data.dbPath, allowDiagnostics: data.allowDiagnostics === true }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requireParentPort(value: typeof parentPort): NonNullable<typeof parentPort> {
  if (!value) throw new Error('Query Worker requires a parent MessagePort')
  return value
}
