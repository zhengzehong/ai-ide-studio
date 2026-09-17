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
  TeamMemberStateQuery,
  TeamMemberStateSnapshot,
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
import type { QueryPriority } from '../data-worker/protocol.js'
import { WorkerRequestError, WorkerRpcClient } from '../data-worker/worker-rpc-client.js'
import { resolveWorkerEntryUrl } from '../data-worker/worker-entry-url.js'
import { createChildLogger } from '../core/logger.js'
import {
  classifyDataWorkerLatency,
  DEFAULT_DATA_WORKER_SLOW_MS,
} from '../data-worker/observability.js'

const log = createChildLogger('query-worker-client')

/**
 * 各查询的默认 deadline(P0-3,单点配置 —— 14 个调用点零改动)。
 * 语义:请求在 worker 队列里等待超过这个时长,出队时会被直接跳过并回 DEADLINE_EXCEEDED,
 * 不再占用唯一的执行槽做"没人要的工作"(事故里 6ms 的查询排了 65.5s 就是被这些死请求堵的)。
 * 取「客户端超时 + 2s 宽限」而不是更小值:worker-rpc-client 的 timeoutMs = min(default, deadline),
 * deadline 一旦小于默认 10s,会连带把客户端超时改小 —— 那就成了与客户端赛跑,而不是兜底。
 * 例外 sessions.recovery:客户端超时同步放宽到 13s(UI 预算 15s,留 2s 余量),
 * 避免它在负载下被原来的 10s 必杀。
 */
export const DEFAULT_DEADLINES: Record<string, number> = {
  'tasks.list': 12_000,
  'tasks.page': 12_000,
  'sessions.list': 12_000,
  'widget.sessions.list': 12_000,
  'sessions.messages': 12_000,
  'sessions.events': 12_000,
  'sessions.recovery': 15_000,
  // 轻量恢复实测 中位 1.1ms / 最大 5.7ms(尾巴 100 条),按普通查询给 12s 兜底足够
  'sessions.teamMemberState': 12_000,
}

/** 重查询走 heavy 档:exec 可达 14.7s,放 interactive 会把它后面所有轻查询一起堵住。 */
export const DEFAULT_PRIORITIES: Record<string, QueryPriority> = {
  'sessions.recovery': 'heavy',
}

/**
 * 各查询的客户端等待上限(P0-3):默认 10s 不动,只有 sessions.recovery 放宽到 13s。
 * 它 exec 实测可达 14.7s,10s 客户端超时等于"负载下必失败" —— 放宽到 13s 后,
 * deadline(15s)仍在客户端超时之上,worker 侧的跳过兜底与客户端超时不再互相打架。
 */
export const DEFAULT_TIMEOUTS: Record<string, number> = {
  'sessions.recovery': 13_000,
}

/** 在飞合并的 key:operation + 规范化 payload(activePromptSessionIds 先排序,顺序不稳定会漏合并)。 */
function coalesceKey(operation: string, payload: unknown): string {
  return `${operation}|${stableJson(payload)}`
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? 'undefined'
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(object).sort().map((key) => [
      key,
      key === 'activePromptSessionIds' && Array.isArray(object[key])
        ? [...(object[key] as unknown[])].sort()
        : canonicalize(object[key]),
    ]),
  )
}

export interface CreateWorkerQueryPortOptions {
  dbPath: string
  getActivePromptSessionIds?: () => readonly string[]
  allowDiagnostics?: boolean
  defaultTimeoutMs?: number
  readyTimeoutMs?: number
  slowRequestMs?: number
}

export interface QueryDiagnosticOptions extends QueryRequestOptions {
  priority?: QueryPriority
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

  /**
   * 在飞合并(P0-3):同一时刻完全相同(operation + payload)的请求共享同一次执行与同一个 promise,
   * 结果广播给所有等待者。只做"在飞"共享、不做 TTL 缓存 —— 陈旧度上界 = 一次查询耗时(6ms~1s),
   * 不会返回过期数据。典型命中:6~7 个会话页同时轮询 sessions.list / widget.sessions.list。
   */
  const inFlight = new Map<string, Promise<unknown>>()
  const coalesce = <TResult>(
    operation: string,
    payload: unknown,
    priority: QueryPriority,
    execute: () => Promise<TResult>,
  ): Promise<TResult> => {
    const key = coalesceKey(operation, payload)
    const existing = inFlight.get(key)
    if (existing) {
      log.debug({ operation, priority }, 'query worker in-flight coalesced')
      return existing as Promise<TResult>
    }
    const pending = execute().finally(() => {
      inFlight.delete(key)
    })
    inFlight.set(key, pending)
    return pending
  }

  const request = async <TResult>(
    operation: string,
    payload: unknown,
    requestOptions: QueryRequestOptions = {},
  ): Promise<TResult> => {
    const priority = requestOptions.priority ?? DEFAULT_PRIORITIES[operation] ?? 'interactive'
    // 默认 deadline(P0-3):让 worker 在出队时能跳过"调用方早就要放弃"的请求。
    // 取「客户端超时 + 2s 宽限」——因为 worker-rpc-client 的 timeoutMs = min(default, deadline),
    // 若 deadline 小于默认 10s 会连带把客户端超时改小,变成与客户端赛跑而不是兜底。
    const deadlineMs = requestOptions.deadlineMs ?? DEFAULT_DEADLINES[operation]
    // 客户端超时:默认由 WorkerRpcClient 的 10s 兜底,只有重查询显式放宽(见 DEFAULT_TIMEOUTS)。
    const timeoutMs = requestOptions.timeoutMs ?? DEFAULT_TIMEOUTS[operation]
    return await coalesce(operation, payload, priority, async () => {
    try {
      const response = await rpc.request<TResult>(operation, payload, {
        priority,
        deadlineMs,
        timeoutMs,
      })
      const context = {
        operation,
        priority,
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
          priority,
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
    })
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
    getTeamMemberState(input: TeamMemberStateQuery): Promise<TeamMemberStateSnapshot> {
      return request('sessions.teamMemberState', input, input)
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
