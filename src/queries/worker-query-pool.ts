import type {
  QueryPage,
  QueryPort,
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
import { WorkerRequestError } from '../data-worker/worker-rpc-client.js'
import {
  createWorkerQueryPort,
  type CreateWorkerQueryPortOptions,
  type QueryDiagnosticOptions,
  type WorkerQueryPort,
} from './worker-query-port.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('query-worker-pool')

export const QUERY_WORKER_POOL_SIZE_ENV = 'QUERY_WORKER_POOL_SIZE'
/** 默认 2:一个 worker 执行重查询(如 recovery)时,另一个还能接轻交互查询。 */
export const DEFAULT_QUERY_WORKER_POOL_SIZE = 2
const MAX_QUERY_WORKER_POOL_SIZE = 8

/**
 * 解析并发池容量(P0-3b)。
 * 1 = 回到改造前的单 worker 行为;非法/越界值退回默认值,不因环境变量写错而拒绝启动。
 */
export function parseQueryWorkerPoolSize(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_QUERY_WORKER_POOL_SIZE
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_QUERY_WORKER_POOL_SIZE
  return Math.min(parsed, MAX_QUERY_WORKER_POOL_SIZE)
}

export interface CreateWorkerQueryPoolOptions extends CreateWorkerQueryPortOptions {
  poolSize?: number
  /** 测试注入:默认 createWorkerQueryPort。 */
  createPort?: (options: CreateWorkerQueryPortOptions) => Promise<WorkerQueryPort>
}

export interface WorkerQueryPool extends QueryPort {
  /** 每个 worker 的 inspection(含 queueDepth 计数),用于确认负载确实被分摊。 */
  inspectAll(): Promise<QueryWorkerInspection[]>
  inspect(): Promise<QueryWorkerInspection>
  diagnose(
    input: QueryWorkerDiagnosticInput,
    options?: QueryDiagnosticOptions,
  ): Promise<QueryWorkerDiagnosticResult>
  terminate(): Promise<void>
  close(): Promise<void>
}

interface PoolMember {
  readonly index: number
  readonly port: WorkerQueryPort
  inFlight: number
  unavailable: boolean
}

/**
 * 查询并发池(P0-3b):K 个 query worker,请求按"在飞最少"分配(相同则轮转)。
 * 单 worker 时 6ms 的查询要排在 14.7s 的重查询后面;池化后重查询只占用一个执行槽,
 * 轻交互查询仍有 worker 可用 —— 这是 P0-3a deadline 之外的第二道保险。
 * 说明:每个 worker 各自持有只读连接(见 query-worker/entry.ts),WAL 下多读者互不阻塞。
 */
export async function createWorkerQueryPool(
  options: CreateWorkerQueryPoolOptions,
): Promise<WorkerQueryPool> {
  const poolSize = options.poolSize ?? parseQueryWorkerPoolSize(process.env[QUERY_WORKER_POOL_SIZE_ENV])
  const createPort = options.createPort ?? createWorkerQueryPort
  const portOptions: CreateWorkerQueryPortOptions = { ...options }
  delete (portOptions as CreateWorkerQueryPoolOptions).poolSize
  delete (portOptions as CreateWorkerQueryPoolOptions).createPort
  const members: PoolMember[] = []
  for (let index = 0; index < poolSize; index += 1) {
    members.push({ index, port: await createPort(portOptions), inFlight: 0, unavailable: false })
  }
  let cursor = 0

  /**
   * 在飞最少者优先;相同则从 cursor 起轮转(而不是总压 index 0)。
   * 有健康 worker 时不再分配给已淘汰的成员;全部淘汰时退回全量选择,
   * 让行为退化回改造前的"单 worker 报错"而不是直接拒绝服务。
   */
  const selectMember = (): PoolMember => {
    const healthy = members.filter((member) => !member.unavailable)
    const candidates = healthy.length > 0 ? healthy : members
    let best: PoolMember | undefined
    for (let offset = 0; offset < members.length; offset += 1) {
      const candidate = members[(cursor + offset) % members.length]!
      if (!candidates.includes(candidate)) continue
      if (!best || candidate.inFlight < best.inFlight) best = candidate
    }
    const selected = best ?? members[0]!
    cursor = (selected.index + 1) % members.length
    return selected
  }

  const dispatch = <TResult>(run: (port: WorkerQueryPort) => Promise<TResult>): Promise<TResult> => {
    const member = selectMember()
    member.inFlight += 1
    return run(member.port).catch((error: unknown) => {
      // 单 worker 不可用只淘汰它自己,其余 worker 继续服务(池化隔离目标)
      if (error instanceof WorkerRequestError && error.code === 'WORKER_UNAVAILABLE' && !member.unavailable) {
        member.unavailable = true
        log.warn({ workerIndex: member.index }, 'query worker unavailable; routing around it')
      }
      throw error
    }).finally(() => {
      member.inFlight -= 1
    })
  }

  return {
    listTasks: (input: TaskListQuery): Promise<TaskListItem[]> => dispatch((port) => port.listTasks(input)),
    listTaskPage: (input: TaskPageQuery): Promise<TaskPage> => dispatch((port) => port.listTaskPage(input)),
    listSessions: (input: SessionListQuery): Promise<SessionListRow[]> => dispatch((port) => port.listSessions(input)),
    listSessionMessages: (input: SessionMessageQuery): Promise<QueryPage<MessageRow>> =>
      dispatch((port) => port.listSessionMessages(input)),
    listSessionEvents: (input: SessionEventQuery): Promise<QueryPage<SessionEventRow>> =>
      dispatch((port) => port.listSessionEvents(input)),
    getSessionRecovery: (input: SessionRecoveryQuery): Promise<SessionRecoverySnapshot> =>
      dispatch((port) => port.getSessionRecovery(input)),
    getTeamMemberState: (input: TeamMemberStateQuery): Promise<TeamMemberStateSnapshot> =>
      dispatch((port) => port.getTeamMemberState(input)),
    listWidgetSessions: (input: WidgetSessionListQuery): Promise<WidgetSessionListItem[]> =>
      dispatch((port) => port.listWidgetSessions(input)),
    inspectAll: (): Promise<QueryWorkerInspection[]> =>
      Promise.all(members.map((member) => member.port.inspect())),
    inspect: (): Promise<QueryWorkerInspection> => dispatch((port) => port.inspect()),
    diagnose: (
      input: QueryWorkerDiagnosticInput,
      diagnosticOptions?: QueryDiagnosticOptions,
    ): Promise<QueryWorkerDiagnosticResult> => dispatch((port) => port.diagnose(input, diagnosticOptions)),
    terminate: async (): Promise<void> => {
      await Promise.all(members.map((member) => member.port.terminate()))
    },
    close: async (): Promise<void> => {
      const results = await Promise.allSettled(members.map((member) => member.port.close()))
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    },
  }
}
