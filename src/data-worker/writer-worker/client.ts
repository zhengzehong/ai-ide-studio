import { Worker } from 'node:worker_threads'
import { createChildLogger } from '../../core/logger.js'
import type {
  DatabaseMaintenanceConfig,
  DatabaseMaintenanceInput,
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
  WriteDataPort,
} from '../../ports/write-data-port.js'
import type { WorkerReadyMessage } from '../protocol.js'
import { WorkerRequestError, WorkerRpcClient } from '../worker-rpc-client.js'
import { resolveWorkerEntryUrl } from '../worker-entry-url.js'
import { classifyDataWorkerLatency, DEFAULT_DATA_WORKER_SLOW_MS } from '../observability.js'

const log = createChildLogger('writer-worker-client')
const MAX_COMMIT_ATTEMPTS = 3

export interface CreateWorkerWriteDataPortOptions {
  dbPath: string
  defaultTimeoutMs?: number
  readyTimeoutMs?: number
  slowRequestMs?: number
  walCheckpointBytes?: number
  publishedOutboxRetentionMs?: number
}

export interface WorkerWriteDataPort extends WriteDataPort {
  terminate(): Promise<void>
}

export async function createWorkerWriteDataPort(
  options: CreateWorkerWriteDataPortOptions,
): Promise<WorkerWriteDataPort> {
  const entryUrl = resolveWorkerEntryUrl('./entry', import.meta.url)
  const worker = new Worker(entryUrl, {
    workerData: {
      dbPath: options.dbPath,
      walCheckpointBytes: options.walCheckpointBytes,
      publishedOutboxRetentionMs: options.publishedOutboxRetentionMs,
    } satisfies { dbPath: string } & DatabaseMaintenanceConfig,
    execArgv: entryUrl.pathname.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
  })
  await waitUntilReady(worker, options.readyTimeoutMs ?? 5_000)
  const rpc = new WorkerRpcClient(worker, { defaultTimeoutMs: options.defaultTimeoutMs })
  const slowRequestMs = options.slowRequestMs ?? DEFAULT_DATA_WORKER_SLOW_MS

  return {
    async commitBatch(batch: WriteBatch): Promise<WriteBatchResult> {
      for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
        try {
          const response = await rpc.request<WriteBatchResult>('writer.commit', batch, {
            priority: batch.priority,
            deadlineMs: batch.deadlineMs,
          })
          const context = {
            batchId: batch.batchId,
            sessionId: batch.sessionId,
            priority: batch.priority,
            attempt,
            slowRequestMs,
            ...response.metrics,
          }
          const latencyCause = classifyDataWorkerLatency(response.metrics, slowRequestMs)
          switch (latencyCause) {
            case 'api_delivery':
              log.warn({ ...context, latencyCause }, 'writer callback delayed by API event loop')
              break
            case 'worker_execution':
              log.warn({ ...context, latencyCause }, 'slow writer batch execution completed')
              break
            case 'worker_queue':
              log.warn({ ...context, latencyCause }, 'writer batch waited in queue')
              break
            default:
              log.debug({ ...context, latencyCause }, 'writer batch committed')
          }
          return response.result
        } catch (err) {
          const canReconcile = err instanceof WorkerRequestError
            && err.code === 'DEADLINE_EXCEEDED'
            && attempt < MAX_COMMIT_ATTEMPTS
          if (canReconcile) {
            log.warn(
              {
                err,
                batchId: batch.batchId,
                sessionId: batch.sessionId,
                priority: batch.priority,
                attempt,
                maxAttempts: MAX_COMMIT_ATTEMPTS,
                ...(err instanceof WorkerRequestError ? workerErrorDiagnostics(err) : {}),
              },
              'writer batch acknowledgement timed out; retrying same batch',
            )
            continue
          }
          log.warn(
            {
              err,
              batchId: batch.batchId,
              sessionId: batch.sessionId,
              priority: batch.priority,
              attempt,
              ...(err instanceof WorkerRequestError ? workerErrorDiagnostics(err) : {}),
            },
            'writer batch failed',
          )
          throw err
        }
      }
      throw new Error(`Writer batch reconciliation exhausted: ${batch.batchId}`)
    },
    async sessionCursor(sessionId: string): Promise<SessionWriteCursor> {
      const response = await rpc.request<SessionWriteCursor>(
        'writer.cursor',
        { sessionId },
        {
          priority: 'interactive',
        },
      )
      return response.result
    },
    async enqueueRuntimeCommand(input: RuntimeCommandInput): Promise<RuntimeCommandEnqueueResult> {
      const response = await rpc.request<RuntimeCommandEnqueueResult>('writer.command.enqueue', input, {
        priority: 'interactive',
      })
      return response.result
    },
    async listRecoverableRuntimeCommands(input: RuntimeCommandRecoveryQuery): Promise<RuntimeCommandRecord[]> {
      const response = await rpc.request<RuntimeCommandRecord[]>(
        'writer.command.recover',
        input,
        {
          priority: 'interactive',
        },
      )
      return response.result
    },
    async updateRuntimeCommand(input: RuntimeCommandUpdate): Promise<RuntimeCommandRecord> {
      const response = await rpc.request<RuntimeCommandRecord>('writer.command.update', input, {
        priority: 'interactive',
      })
      return response.result
    },
    async maintain(input: DatabaseMaintenanceInput): Promise<DatabaseMaintenanceResult> {
      const response = await rpc.request<DatabaseMaintenanceResult>('writer.maintain', input, {
        priority: 'background',
      })
      log.debug(response.result, 'Writer database maintenance completed')
      return response.result
    },
    async inspectRetention(input: RetentionInspectInput): Promise<RetentionInspectResult> {
      const response = await rpc.request<RetentionInspectResult>('writer.retention.inspect', input, {
        priority: 'background',
        timeoutMs: 120_000,
      })
      log.info({ ...response.result, ...response.metrics }, 'retention dry-run completed')
      return response.result
    },
    async runRetentionBatch(input: RetentionBatchInput): Promise<RetentionBatchResult> {
      const response = await rpc.request<RetentionBatchResult>('writer.retention.batch', input, {
        priority: 'background',
        timeoutMs: 30_000,
      })
      log.debug({ ...response.result, ...response.metrics }, 'retention batch completed')
      return response.result
    },
    drain(): Promise<void> {
      return rpc.drain()
    },
    async close(): Promise<void> {
      await rpc.drain()
      await rpc.close()
    },
    terminate(): Promise<void> {
      return rpc.close()
    },
  }
}

function workerErrorDiagnostics(error: WorkerRequestError): Record<string, unknown> {
  return {
    ...error.metrics,
    requestId: error.requestId,
    workerOperation: error.operation,
    workerErrorCode: error.code,
    clientObservedMs: error.clientObservedMs,
  }
}

function waitUntilReady(worker: Worker, timeoutMs: number): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      cleanup()
      rejectReady(new Error(`Writer Worker readiness timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const onMessage = (message: unknown): void => {
      if (!isReadyMessage(message)) return
      cleanup()
      resolveReady()
    }
    const onError = (error: Error): void => {
      cleanup()
      rejectReady(error)
    }
    const onExit = (code: number): void => {
      cleanup()
      rejectReady(new Error(`Writer Worker exited before ready with code ${code}`))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
  })
}

function isReadyMessage(value: unknown): value is WorkerReadyMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return message.kind === 'ready' && message.worker === 'writer'
}
