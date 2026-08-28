import { Worker } from 'node:worker_threads'
import type {
  QueryPage,
  QueryPort,
  QueryRequestOptions,
  SessionEventQuery,
  SessionListQuery,
  SessionMessageQuery,
  SessionRecoveryQuery,
  SessionRecoverySnapshot,
  TaskListItem,
  TaskListQuery,
  TaskPage,
  TaskPageQuery,
  WidgetSessionListItem,
  WidgetSessionListQuery,
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
  classifyDataWorkerLatency,
  DEFAULT_DATA_WORKER_SLOW_MS,
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
        ...requestIdentity(payload),
        ...response.metrics,
      }
      const latencyCause = classifyDataWorkerLatency(response.metrics, slowRequestMs)
      switch (latencyCause) {
        case 'api_delivery':
          log.warn({ ...context, latencyCause }, 'query worker callback delayed by API event loop')
          break
        case 'worker_execution':
          log.warn({ ...context, latencyCause }, 'slow query worker execution completed')
          break
        case 'worker_queue':
          log.warn({ ...context, latencyCause }, 'query worker request waited in queue')
          break
        default:
          log.debug({ ...context, latencyCause }, 'query worker request completed')
      }
      return response.result
    } catch (err) {
      log.warn(
        {
          err,
          operation,
          priority: requestOptions.priority ?? 'interactive',
          ...(err instanceof WorkerRequestError ? {
            ...err.metrics,
            requestId: err.requestId,
            workerOperation: err.operation,
            workerErrorCode: err.code,
            clientObservedMs: err.clientObservedMs,
          } : {}),
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
    listTaskPage(input: TaskPageQuery): Promise<TaskPage> {
      return request('tasks.page', input, input)
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
    getSessionRecovery(input: SessionRecoveryQuery): Promise<SessionRecoverySnapshot> {
      return request('sessions.recovery', input, input)
    },
    listWidgetSessions(input: WidgetSessionListQuery): Promise<WidgetSessionListItem[]> {
      return request('widget.sessions.list', {
        ...input,
        activePromptSessionIds: [...getActivePromptSessionIds()],
      }, input)
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

function requestIdentity(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const record = payload as Record<string, unknown>
  const identity: Record<string, string> = {}
  for (const key of ['sessionId', 'projectId', 'agentId']) {
    if (typeof record[key] === 'string') identity[key] = record[key]
  }
  return identity
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
