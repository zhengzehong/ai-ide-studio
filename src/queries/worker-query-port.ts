import { Worker } from 'node:worker_threads'
import type {
  QueryPage,
  QueryPort,
  QueryRequestOptions,
  SessionEventQuery,
  SessionListQuery,
  SessionMessageQuery,
  TaskListItem,
  TaskListQuery,
} from '../ports/query-port.js'
import type { MessageRow, SessionEventRow, SessionListRow } from '../store/sessions.js'
import type {
  QueryWorkerDiagnosticInput,
  QueryWorkerDiagnosticResult,
  QueryWorkerInspection,
} from '../data-worker/query-worker/operations.js'
import type { WorkerReadyMessage } from '../data-worker/protocol.js'
import { WorkerRequestError, WorkerRpcClient } from '../data-worker/worker-rpc-client.js'
import { resolveWorkerEntryUrl } from '../data-worker/worker-entry-url.js'
import { createChildLogger } from '../core/logger.js'
import {
  DEFAULT_DATA_WORKER_SLOW_MS,
  isSlowWorkerRequest,
} from '../data-worker/observability.js'

const log = createChildLogger('query-worker-client')

export interface CreateWorkerQueryPortOptions {
  dbPath: string
  getActivePromptSessionIds?: () => readonly string[]
  allowDiagnostics?: boolean
  defaultTimeoutMs?: number
  readyTimeoutMs?: number
  slowRequestMs?: number
}

export interface QueryDiagnosticOptions extends QueryRequestOptions {
  priority?: 'interactive' | 'background'
}

export interface WorkerQueryPort extends QueryPort {
  inspect(): Promise<QueryWorkerInspection>
  diagnose(
    input: QueryWorkerDiagnosticInput,
    options?: QueryDiagnosticOptions,
  ): Promise<QueryWorkerDiagnosticResult>
  terminate(): Promise<void>
  close(): Promise<void>
}

export async function createWorkerQueryPort(
  options: CreateWorkerQueryPortOptions,
): Promise<WorkerQueryPort> {
  const entryUrl = resolveWorkerEntryUrl('../data-worker/query-worker/entry', import.meta.url)
  const isTypeScript = entryUrl.pathname.endsWith('.ts')
  const worker = new Worker(entryUrl, {
    workerData: {
      dbPath: options.dbPath,
      allowDiagnostics: options.allowDiagnostics === true,
    },
    execArgv: isTypeScript ? ['--import', 'tsx'] : undefined,
  })
  await waitUntilReady(worker, options.readyTimeoutMs ?? 5_000)
  const rpc = new WorkerRpcClient(worker, { defaultTimeoutMs: options.defaultTimeoutMs })
  const getActivePromptSessionIds = options.getActivePromptSessionIds ?? (() => [])
  const slowRequestMs = options.slowRequestMs ?? DEFAULT_DATA_WORKER_SLOW_MS

  const request = async <TResult>(
    operation: string,
    payload: unknown,
    requestOptions: QueryRequestOptions = {},
  ): Promise<TResult> => {
    try {
      const response = await rpc.request<TResult>(operation, payload, {
        priority: requestOptions.priority ?? 'interactive',
        deadlineMs: requestOptions.deadlineMs,
      })
      const context = {
        operation,
        priority: requestOptions.priority ?? 'interactive',
        slowRequestMs,
        ...response.metrics,
      }
      if (isSlowWorkerRequest(response.metrics, slowRequestMs)) {
        log.warn(context, 'slow query worker request completed')
      } else {
        log.debug(context, 'query worker request completed')
      }
      return response.result
    } catch (err) {
      log.warn(
        {
          err,
          operation,
          priority: requestOptions.priority ?? 'interactive',
          ...(err instanceof WorkerRequestError ? err.metrics : undefined),
        },
        'query worker request failed',
      )
      throw err
    }
  }

  return {
    listTasks(input: TaskListQuery): Promise<TaskListItem[]> {
      return request('tasks.list', input, input)
    },
    listSessions(input: SessionListQuery): Promise<SessionListRow[]> {
      return request('sessions.list', {
        ...input,
        activePromptSessionIds: [...getActivePromptSessionIds()],
      }, input)
    },
    listSessionMessages(input: SessionMessageQuery): Promise<QueryPage<MessageRow>> {
      return request('sessions.messages', input, input)
    },
    listSessionEvents(input: SessionEventQuery): Promise<QueryPage<SessionEventRow>> {
      return request('sessions.events', input, input)
    },
    inspect(): Promise<QueryWorkerInspection> {
      return request('worker.inspect', {}, { priority: 'interactive' })
    },
    diagnose(
      input: QueryWorkerDiagnosticInput,
      diagnosticOptions: QueryDiagnosticOptions = {},
    ): Promise<QueryWorkerDiagnosticResult> {
      return request('worker.diagnose', input, diagnosticOptions)
    },
    terminate(): Promise<void> {
      return rpc.close()
    },
    close(): Promise<void> {
      return rpc.close()
    },
  }
}

function waitUntilReady(worker: Worker, timeoutMs: number): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      cleanup()
      rejectReady(new Error(`Query Worker readiness timed out after ${timeoutMs}ms`))
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
      rejectReady(new Error(`Query Worker exited before ready with code ${code}`))
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
  return message.kind === 'ready' && message.worker === 'query'
}
