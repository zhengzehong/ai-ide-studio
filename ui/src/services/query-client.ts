import { getStoredAccessToken } from '../stores/connection.store'
import type { SessionData } from '../stores/session.store'
import type { MessageData, SessionEventData } from '../stores/session-events'
import type { TaskData } from '../stores/task.store'
import { wsClient } from './ws-client'

export interface QueryPage<T> {
  items: T[]
  hasMore: boolean
  nextCursor: string | null
}

export interface TaskListQuery {
  projectId?: string
  status?: string
}

export interface SessionListQuery {
  projectId?: string
  agentId?: string
}

export interface SessionMessageQuery {
  sessionId: string
  limit?: number
  before?: string
  includeToolCalls?: boolean
  includeLatestToolCalls?: boolean
}

export interface SessionEventQuery {
  sessionId: string
  limit?: number
  afterSequence?: number
}

export interface SessionRecoveryQuery {
  sessionId: string
  limit?: number
}

export interface SessionRecoverySnapshot {
  sessionId: string
  latestSequence: number
  events: SessionEventData[]
}

export interface QueryClient {
  listTasks(input: TaskListQuery): Promise<TaskData[]>
  listSessions(input: SessionListQuery): Promise<SessionData[]>
  listSessionMessages(input: SessionMessageQuery): Promise<QueryPage<MessageData>>
  listSessionEvents(input: SessionEventQuery): Promise<QueryPage<SessionEventData>>
  getSessionRecovery(input: SessionRecoveryQuery): Promise<SessionRecoverySnapshot>
}

export interface HttpQueryClientOptions {
  fetchImpl?: typeof fetch
  getAccessToken?: () => string
  timeoutMs?: number
}

type WsRequest = (message: Record<string, unknown>) => Promise<unknown>
type QueryTransport = 'http' | 'ws'

const DEFAULT_TIMEOUT_MS = 15_000

export function createHttpQueryClient(options: HttpQueryClientOptions = {}): QueryClient {
  const fetchImpl = options.fetchImpl ?? fetch
  const getAccessToken = options.getAccessToken ?? getStoredAccessToken
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    listTasks(input) {
      return requestList<TaskData>(fetchImpl, getAccessToken, timeoutMs, '/api/v1/tasks', {
        projectId: input.projectId,
        status: input.status,
      })
    },

    listSessions(input) {
      return requestList<SessionData>(fetchImpl, getAccessToken, timeoutMs, '/api/v1/sessions', {
        projectId: input.projectId,
        agentId: input.agentId,
      })
    },

    listSessionMessages(input) {
      return requestPage<MessageData>(
        fetchImpl,
        getAccessToken,
        timeoutMs,
        `/api/v1/sessions/${encodeURIComponent(input.sessionId)}/messages`,
        {
          limit: input.limit,
          before: input.before,
          includeToolCalls: input.includeToolCalls,
          includeLatestToolCalls: input.includeLatestToolCalls,
        },
      )
    },

    listSessionEvents(input) {
      return requestPage<SessionEventData>(
        fetchImpl,
        getAccessToken,
        timeoutMs,
        `/api/v1/sessions/${encodeURIComponent(input.sessionId)}/events`,
        { limit: input.limit, afterSequence: input.afterSequence },
      )
    },

    async getSessionRecovery(input) {
      const envelope = await requestEnvelope(
        fetchImpl,
        getAccessToken,
        timeoutMs,
        `/api/v1/sessions/${encodeURIComponent(input.sessionId)}/recovery`,
        { limit: input.limit },
      )
      return parseSessionRecoverySnapshot(envelope.data)
    },
  }
}

export function createWsQueryClient(request: WsRequest = (message) => wsClient.request(message)): QueryClient {
  return {
    async listTasks(input) {
      const message: Record<string, unknown> = { type: 'tasks.list' }
      addDefined(message, 'projectId', input.projectId)
      addDefined(message, 'status', input.status)
      return toArray<TaskData>(await request(message))
    },

    async listSessions(input) {
      const message: Record<string, unknown> = { type: 'sessions.list' }
      addDefined(message, 'projectId', input.projectId)
      addDefined(message, 'agentId', input.agentId)
      return toArray<SessionData>(await request(message))
    },

    async listSessionMessages(input) {
      const message: Record<string, unknown> = { type: 'sessions.messages', sessionId: input.sessionId }
      addDefined(message, 'limit', input.limit)
      addDefined(message, 'before', input.before)
      addDefined(message, 'includeToolCalls', input.includeToolCalls)
      addDefined(message, 'includeLatestToolCalls', input.includeLatestToolCalls)
      const items = toArray<MessageData>(await request(message))
      const limit = input.limit ?? 100
      const hasMore = items.length >= limit
      return {
        items,
        hasMore,
        nextCursor: hasMore ? (items[0]?.timestamp ?? null) : null,
      }
    },

    async listSessionEvents(input) {
      const message: Record<string, unknown> = { type: 'sessions.events', sessionId: input.sessionId }
      addDefined(message, 'limit', input.limit)
      addDefined(message, 'afterSequence', input.afterSequence)
      const items = toArray<SessionEventData>(await request(message))
      const limit = input.limit ?? 500
      const hasMore = items.length >= limit
      return {
        items,
        hasMore,
        nextCursor: hasMore && items.length > 0 ? String(items.at(-1)?.sequence) : null,
      }
    },

    async getSessionRecovery(input) {
      const page = await this.listSessionEvents({
        sessionId: input.sessionId,
        limit: input.limit,
      })
      return {
        sessionId: input.sessionId,
        latestSequence: page.items.at(-1)?.sequence ?? 0,
        events: filterRecoveryEvents(page.items),
      }
    },
  }
}

const MIRRORED_RECOVERY_EVENT_TYPES = new Set([
  'message.chunk',
  'thinking.chunk',
  'tool.call',
  'tool.update',
  'message.done',
])

const INTERACTION_EVENT_TYPES = new Set([
  'permission.request',
  'permission.result',
  'elicitation.request',
  'elicitation.result',
])

function filterRecoveryEvents(events: SessionEventData[]): SessionEventData[] {
  const latestDoneSequence = events.reduce(
    (latest, event) => event.type === 'message.done' ? Math.max(latest, event.sequence) : latest,
    0,
  )
  return events.filter((event) => !MIRRORED_RECOVERY_EVENT_TYPES.has(event.type)
    && (!INTERACTION_EVENT_TYPES.has(event.type) || event.sequence > latestDoneSequence))
}

function parseSessionRecoverySnapshot(value: unknown): SessionRecoverySnapshot {
  if (!isRecord(value)
    || typeof value.sessionId !== 'string'
    || typeof value.latestSequence !== 'number'
    || !Number.isInteger(value.latestSequence)
    || value.latestSequence < 0
    || !Array.isArray(value.events)) {
    throw new Error('会话恢复响应无效')
  }
  return {
    sessionId: value.sessionId,
    latestSequence: value.latestSequence,
    events: value.events as SessionEventData[],
  }
}

export function resolveQueryTransport(mode: string, configured?: string): QueryTransport {
  if (mode === 'test') return 'ws'
  return configured?.trim().toLowerCase() === 'ws' ? 'ws' : 'http'
}

const selectedTransport = resolveQueryTransport(
  import.meta.env.MODE,
  import.meta.env.VITE_QUERY_TRANSPORT as string | undefined,
)

export const queryClient: QueryClient = selectedTransport === 'ws'
  ? createWsQueryClient()
  : createHttpQueryClient()

async function requestList<T>(
  fetchImpl: typeof fetch,
  getAccessToken: () => string,
  timeoutMs: number,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T[]> {
  const envelope = await requestEnvelope(fetchImpl, getAccessToken, timeoutMs, path, query)
  if (!Array.isArray(envelope.data)) throw new Error('查询响应无效')
  return toArray<T>(envelope.data)
}

async function requestPage<T>(
  fetchImpl: typeof fetch,
  getAccessToken: () => string,
  timeoutMs: number,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<QueryPage<T>> {
  const envelope = await requestEnvelope(fetchImpl, getAccessToken, timeoutMs, path, query)
  if (!Array.isArray(envelope.data)) throw new Error('查询响应无效')
  if (!isRecord(envelope.page) || typeof envelope.page.hasMore !== 'boolean') {
    throw new Error('查询分页响应无效')
  }
  const nextCursor = envelope.page.nextCursor
  if (nextCursor !== null && typeof nextCursor !== 'string') throw new Error('查询分页游标无效')
  return {
    items: toArray<T>(envelope.data),
    hasMore: envelope.page.hasMore,
    nextCursor,
  }
}

async function requestEnvelope(
  fetchImpl: typeof fetch,
  getAccessToken: () => string,
  timeoutMs: number,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<Record<string, unknown>> {
  const token = getAccessToken().trim()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers['x-ai-ide-token'] = token
  let response: Response
  try {
    response = await fetchImpl(withQuery(path, query), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (isAbortError(error)) throw new Error('查询超时', { cause: error })
    throw error
  }
  const body = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string'
      ? body.error
      : `查询失败（HTTP ${response.status}）`
    throw new Error(message)
  }
  if (!isRecord(body) || !('data' in body)) throw new Error('查询响应无效')
  return body
}

function withQuery(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded ? `${path}?${encoded}` : path
}

function addDefined(
  target: Record<string, unknown>,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value !== undefined) target[key] = value
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
