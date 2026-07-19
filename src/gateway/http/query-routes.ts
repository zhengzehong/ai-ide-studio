import type { Context, Hono } from 'hono'
import type { QueryPage, QueryPort } from '../../ports/query-port.js'
import { createChildLogger } from '../../core/logger.js'
import { getQueryPort } from '../../queries/query-port-provider.js'
import { WorkerRequestError } from '../../data-worker/worker-rpc-client.js'

const log = createChildLogger('gateway:http-query')
const QUERY_RESPONSE_BUDGET_BYTES = 1024 * 1024

interface QueryEnvelope {
  data: unknown[]
  page?: {
    hasMore: boolean
    nextCursor: string | null
  }
}

type ParsedValue<T> = { value: T } | { error: string }

export function mountQueryRoutes(app: Hono, queryPort?: QueryPort): void {
  app.get('/api/v1/tasks', async (c) => runQuery(c, 'tasks.list', async () => ({
    data: await resolveQueryPort(queryPort).listTasks({
      projectId: optionalText(c.req.query('projectId')),
      status: optionalText(c.req.query('status')),
      priority: 'interactive',
    }),
  })))

  app.get('/api/v1/sessions', async (c) => runQuery(c, 'sessions.list', async () => ({
    data: await resolveQueryPort(queryPort).listSessions({
      projectId: optionalText(c.req.query('projectId')),
      agentId: optionalText(c.req.query('agentId')),
      priority: 'interactive',
    }),
  })))

  app.get('/api/v1/sessions/:sessionId/messages', async (c) => {
    const limit = parsePositiveInteger(c.req.query('limit'), 'limit')
    if ('error' in limit) return c.json({ error: limit.error }, 400)
    const includeToolCalls = parseBoolean(c.req.query('includeToolCalls'), 'includeToolCalls')
    if ('error' in includeToolCalls) return c.json({ error: includeToolCalls.error }, 400)
    const includeLatestToolCalls = parseBoolean(
      c.req.query('includeLatestToolCalls'),
      'includeLatestToolCalls',
    )
    if ('error' in includeLatestToolCalls) return c.json({ error: includeLatestToolCalls.error }, 400)

    return runQuery(c, 'sessions.messages', async () => pageEnvelope(
      await resolveQueryPort(queryPort).listSessionMessages({
        sessionId: c.req.param('sessionId'),
        limit: limit.value,
        before: optionalText(c.req.query('before')),
        includeToolCalls: includeToolCalls.value,
        includeLatestToolCalls: includeLatestToolCalls.value,
        priority: 'interactive',
      }),
    ))
  })

  app.get('/api/v1/sessions/:sessionId/events', async (c) => {
    const limit = parsePositiveInteger(c.req.query('limit'), 'limit')
    if ('error' in limit) return c.json({ error: limit.error }, 400)
    const afterSequence = parseNonNegativeInteger(c.req.query('afterSequence'), 'afterSequence')
    if ('error' in afterSequence) return c.json({ error: afterSequence.error }, 400)

    return runQuery(c, 'sessions.events', async () => pageEnvelope(
      await resolveQueryPort(queryPort).listSessionEvents({
        sessionId: c.req.param('sessionId'),
        limit: limit.value,
        afterSequence: afterSequence.value,
        priority: 'interactive',
      }),
    ))
  })
}

function pageEnvelope<T>(page: QueryPage<T>): QueryEnvelope {
  return {
    data: page.items,
    page: { hasMore: page.hasMore, nextCursor: page.nextCursor },
  }
}

async function runQuery(
  c: Context,
  queryName: string,
  execute: () => Promise<QueryEnvelope>,
): Promise<Response> {
  const startedAt = performance.now()
  try {
    const envelope = await execute()
    const elapsedMs = performance.now() - startedAt
    const body = JSON.stringify(envelope)
    const responseBytes = Buffer.byteLength(body, 'utf8')
    const context = {
      queryName,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      itemCount: envelope.data.length,
      responseBytes,
    }
    if (responseBytes > QUERY_RESPONSE_BUDGET_BYTES) {
      log.warn(context, 'HTTP query response exceeded observation budget')
    } else {
      log.debug(context, 'HTTP query completed')
    }
    c.header('Cache-Control', 'no-store')
    c.header('Server-Timing', `query;dur=${elapsedMs.toFixed(1)}`)
    c.header('X-Response-Bytes', String(responseBytes))
    c.header('Content-Type', 'application/json; charset=UTF-8')
    return c.body(body)
  } catch (err) {
    const elapsedMs = performance.now() - startedAt
    log.error({ err, queryName, elapsedMs: Number(elapsedMs.toFixed(2)) }, 'HTTP query failed')
    if (err instanceof WorkerRequestError && err.code === 'WORKER_UNAVAILABLE') {
      return c.json({ error: '查询服务暂不可用' }, 503)
    }
    if (err instanceof WorkerRequestError && err.code === 'DEADLINE_EXCEEDED') {
      return c.json({ error: '查询超时' }, 504)
    }
    return c.json({ error: '查询失败' }, 500)
  }
}

function resolveQueryPort(queryPort: QueryPort | undefined): QueryPort {
  return queryPort ?? getQueryPort()
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function parsePositiveInteger(value: string | undefined, name: string): ParsedValue<number | undefined> {
  if (value == null || value === '') return { value: undefined }
  if (!/^\d+$/.test(value) || Number(value) < 1) return { error: `${name} 必须是正整数` }
  return { value: Number(value) }
}

function parseNonNegativeInteger(
  value: string | undefined,
  name: string,
): ParsedValue<number | undefined> {
  if (value == null || value === '') return { value: undefined }
  if (!/^\d+$/.test(value)) return { error: `${name} 必须是非负整数` }
  return { value: Number(value) }
}

function parseBoolean(value: string | undefined, name: string): ParsedValue<boolean | undefined> {
  if (value == null || value === '') return { value: undefined }
  if (value === 'true') return { value: true }
  if (value === 'false') return { value: false }
  return { error: `${name} 必须是布尔值` }
}
