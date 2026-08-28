import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Server } from 'node:http'
import { once } from 'node:events'
import type { WebSocketServer } from 'ws'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { startGateway } from '../../src/gateway/server.js'
import { taskStore } from '../../src/store/tasks.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'
import type { QueryPort } from '../../src/ports/query-port.js'
import { WorkerRequestError } from '../../src/data-worker/worker-rpc-client.js'
import { operationDiagnostics } from '../../src/shared/operation-diagnostics.js'

const ACCESS_TOKEN = 'query-route-secret'

let tmp: string
let server: Server | undefined
let wss: WebSocketServer | undefined

beforeEach(() => {
  operationDiagnostics.clear()
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-http-query-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(async () => {
  if (wss) {
    wss.close()
    wss = undefined
  }
  if (server) {
    await new Promise<void>((resolveClose) => server?.close(() => resolveClose()))
    server = undefined
  }
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('versioned HTTP query routes', () => {
  test('authenticates and exposes observable task and session lists', async () => {
    const projectId = 'project-http-query'
    const task = taskStore.create({ title: 'HTTP task', description: 'HTTP task', projectId })
    const session = sessionStore.create({ agentId: 'agent-http', taskId: task.id, projectId })
    await startTestGateway()

    const desktopInfoUnauthorized = await fetch(`${baseUrl()}/api/v1/desktop-info`)
    const desktopInfo = await queryFetch('/api/v1/desktop-info')
    const unauthorized = await fetch(`${baseUrl()}/api/v1/tasks?projectId=${projectId}`)
    const taskResponse = await queryFetch(`/api/v1/tasks?projectId=${projectId}`)
    const sessionResponse = await queryFetch(`/api/v1/sessions?projectId=${projectId}&agentId=agent-http`)

    expect(desktopInfoUnauthorized.status).toBe(401)
    expect(desktopInfo.status).toBe(200)
    expect(await desktopInfo.json()).toEqual({ product: 'ai-ide-studio', protocolVersion: '1' })
    expect(unauthorized.status).toBe(401)
    expect(taskResponse.status).toBe(200)
    expect(await taskResponse.json()).toMatchObject({
      data: [{ id: task.id, sessionId: session.id }],
    })
    expect(taskResponse.headers.get('cache-control')).toBe('no-store')
    expect(taskResponse.headers.get('server-timing')).toMatch(
      /^query;dur=\d+(?:\.\d+)?, serialize;dur=\d+(?:\.\d+)?, total;dur=\d+(?:\.\d+)?$/,
    )
    expect(Number(taskResponse.headers.get('x-response-bytes'))).toBeGreaterThan(0)
    expect(await sessionResponse.json()).toMatchObject({
      data: [{ id: session.id, activity_state: 'idle' }],
    })
    expect(operationDiagnostics.snapshot().recentSyncOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationModule: 'gateway:http-query',
        operation: 'response.serialize',
        context: expect.objectContaining({ queryName: 'sessions.list' }),
      }),
    ]))
  })

  test('validates numeric and boolean history query parameters', async () => {
    const session = sessionStore.create({ agentId: 'agent-validation' })
    await startTestGateway()

    const invalidLimit = await queryFetch(`/api/v1/sessions/${session.id}/messages?limit=many`)
    const invalidBoolean = await queryFetch(
      `/api/v1/sessions/${session.id}/messages?includeToolCalls=sometimes`,
    )
    const invalidSequence = await queryFetch(`/api/v1/sessions/${session.id}/events?afterSequence=-1`)

    expect(invalidLimit.status).toBe(400)
    expect(await invalidLimit.json()).toEqual({ error: 'limit 必须是正整数' })
    expect(invalidBoolean.status).toBe(400)
    expect(await invalidBoolean.json()).toEqual({ error: 'includeToolCalls 必须是布尔值' })
    expect(invalidSequence.status).toBe(400)
    expect(await invalidSequence.json()).toEqual({ error: 'afterSequence 必须是非负整数' })
  })

  test('returns bounded message pages with an explicit older-history cursor', async () => {
    const session = sessionStore.create({ agentId: 'agent-message-page' })
    const timestamps = [
      '2026-07-19T00:00:01.000Z',
      '2026-07-19T00:00:02.000Z',
      '2026-07-19T00:00:03.000Z',
      '2026-07-19T00:00:04.000Z',
    ]
    const messages = timestamps.map((timestamp, index) => {
      const message = messageStore.append(session.id, { role: 'user', content: `message-${index}` })
      getDb().prepare('UPDATE messages SET timestamp = ? WHERE id = ?').run(timestamp, message.id)
      return message
    })
    await startTestGateway()

    const response = await queryFetch(`/api/v1/sessions/${session.id}/messages?limit=2`)
    const body = await response.json() as {
      data: Array<{ id: string }>
      page: { hasMore: boolean; nextCursor: string | null }
    }

    expect(response.status).toBe(200)
    expect(body.data.map((message) => message.id)).toEqual([messages[2].id, messages[3].id])
    expect(body.page).toEqual({ hasMore: true, nextCursor: timestamps[2] })
  })

  test('compresses large JSON query responses when the client accepts gzip', async () => {
    const session = sessionStore.create({ agentId: 'agent-compressed-query' })
    const content = 'compressible history '.repeat(2_000)
    messageStore.append(session.id, { role: 'agent', content })
    await startTestGateway()

    const response = await fetch(`${baseUrl()}/api/v1/sessions/${session.id}/messages?limit=20`, {
      headers: {
        'Accept-Encoding': 'gzip',
        'x-ai-ide-token': ACCESS_TOKEN,
      },
    })
    const body = await response.json() as { data: Array<{ content: string }> }

    expect(response.status).toBe(200)
    expect(response.headers.get('content-encoding')).toBe('gzip')
    expect(response.headers.get('vary')).toContain('Accept-Encoding')
    expect(body.data[0]?.content).toBe(content)
  })

  test('returns recovery events after a sequence without skipping an intermediate page', async () => {
    const session = sessionStore.create({ agentId: 'agent-event-page' })
    for (let index = 0; index < 5; index += 1) {
      eventStore.append(session.id, {
        type: 'message.chunk',
        messageId: `message-${index}`,
        payload: { content: String(index) },
      })
    }
    await startTestGateway()

    const response = await queryFetch(
      `/api/v1/sessions/${session.id}/events?limit=2&afterSequence=1`,
    )
    const body = await response.json() as {
      data: Array<{ sequence: number }>
      page: { hasMore: boolean; nextCursor: string | null }
    }

    expect(response.status).toBe(200)
    expect(body.data.map((event) => event.sequence)).toEqual([2, 3])
    expect(body.page).toEqual({ hasMore: true, nextCursor: '3' })
  })

  test('returns a bounded task description preview instead of the full task body', async () => {
    const projectId = 'project-task-summary'
    const description = `Task goal: ${'detail '.repeat(1000)}`
    const task = taskStore.create({ title: 'Summary task', description, projectId })
    await startTestGateway()

    const response = await queryFetch(`/api/v1/tasks?projectId=${projectId}`)
    const body = await response.json() as {
      data: Array<Record<string, unknown>>
    }
    const listed = body.data.find((item) => item.id === task.id)

    expect(response.status).toBe(200)
    expect(listed).toBeDefined()
    expect(listed).not.toHaveProperty('description')
    expect(listed?.descriptionPreview).toBeTypeOf('string')
    expect(String(listed?.descriptionPreview).length).toBeLessThanOrEqual(240)
    expect(JSON.stringify(body)).not.toContain(description)
  })

  test('returns an explicit task page envelope with totals', async () => {
    const projectId = 'project-task-page'
    const older = taskStore.create({ title: 'Older task', projectId })
    const newer = taskStore.create({ title: 'Newer task', projectId })
    getDb().prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run('2026-08-24T00:00:00.000Z', older.id)
    getDb().prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run('2026-08-25T00:00:00.000Z', newer.id)
    await startTestGateway()

    const response = await queryFetch(`/api/v1/tasks/page?projectId=${projectId}&limit=1`)
    const body = await response.json() as {
      data: Array<{ id: string }>
      page: { hasMore: boolean; nextCursor: string | null; total: number }
    }

    expect(response.status).toBe(200)
    expect(body.data.map((task) => task.id)).toEqual([newer.id])
    expect(body.page).toEqual({ hasMore: true, nextCursor: newer.id, total: 2 })
  })

  test('returns 400 for a task cursor outside the page filters', async () => {
    const projectId = 'project-task-page-cursor'
    const completed = taskStore.create({ title: 'Completed cursor', projectId })
    getDb().prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(completed.id)
    await startTestGateway()

    const response = await queryFetch(
      `/api/v1/tasks/page?projectId=${projectId}&excludeTerminal=true&cursor=${completed.id}`,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid task cursor' })
  })

  test('returns a lightweight recovery snapshot without mirrored tool payloads', async () => {
    const session = sessionStore.create({ agentId: 'agent-recovery-snapshot' })
    const largePayload = 'x'.repeat(1024 * 1024)
    eventStore.append(session.id, {
      type: 'message.chunk',
      messageId: 'message-running',
      payload: { content: largePayload },
    })
    eventStore.append(session.id, {
      type: 'tool.call',
      messageId: 'message-running',
      payload: { rawInput: largePayload },
    })
    eventStore.append(session.id, {
      type: 'session:capabilities',
      payload: { currentModeId: 'plan' },
    })
    eventStore.append(session.id, {
      type: 'tool.update',
      messageId: 'message-running',
      payload: { rawOutput: largePayload },
    })
    eventStore.append(session.id, {
      type: 'permission.request',
      payload: { requestId: 'permission-a', title: '允许读取文件' },
    })
    eventStore.append(session.id, {
      type: 'message.done',
      messageId: 'message-running',
      payload: { stopReason: 'end_turn' },
    })
    eventStore.append(session.id, {
      type: 'permission.request',
      payload: { permissionRequest: { id: 'permission-active', title: '允许写入文件', options: [] } },
    })
    await startTestGateway()

    const response = await queryFetch(`/api/v1/sessions/${session.id}/recovery?limit=100`)
    const body = await response.json() as {
      data: {
        sessionId: string
        latestSequence: number
        events: Array<{ type: string; sequence: number }>
      }
    }

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      sessionId: session.id,
      latestSequence: 7,
    })
    expect(body.data.events.map((event) => event.type)).toEqual([
      'session:capabilities',
      'permission.request',
    ])
    const recoveredPermissionIds = body.data.events
      .filter((event) => event.type === 'permission.request')
      .map((event) => JSON.parse(String((event as { payload_json?: string }).payload_json)).permissionRequest.id)
    expect(recoveredPermissionIds).toEqual(['permission-active'])
    expect(Number(response.headers.get('x-response-bytes'))).toBeLessThan(256 * 1024)
  })

  test('maps query worker availability and deadline failures without synchronous fallback', async () => {
    const queryPort = failingQueryPort()
    await startTestGateway(queryPort)

    const unavailable = await queryFetch('/api/v1/tasks')
    const deadline = await queryFetch('/api/v1/tasks?status=deadline')

    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ error: '查询服务暂不可用' })
    expect(deadline.status).toBe(504)
    expect(await deadline.json()).toEqual({ error: '查询超时' })
  })
})

async function startTestGateway(queryPort?: QueryPort): Promise<void> {
  const handle = await startGateway({
    host: '127.0.0.1',
    port: 0,
    dataDir: tmp,
    runtime: 'web',
    localToken: ACCESS_TOKEN,
  }, { queryPort })
  server = handle.server
  wss = handle.wss
  if (!server.listening) await once(server, 'listening')
}

function failingQueryPort(): QueryPort {
  const fail = (status?: string): never => {
    if (status === 'deadline') {
      throw new WorkerRequestError('DEADLINE_EXCEEDED', 'test deadline')
    }
    throw new WorkerRequestError('WORKER_UNAVAILABLE', 'test unavailable')
  }
  return {
    async listTasks(input) { return fail(input.status) },
    async listTaskPage(input) { return fail(input.status) },
    async listSessions() { return fail() },
    async listSessionMessages() { return fail() },
    async listSessionEvents() { return fail() },
    async getSessionRecovery() { return fail() },
    async listWidgetSessions() { return fail() },
  }
}

function baseUrl(): string {
  const address = server?.address()
  if (!address || typeof address === 'string') throw new Error('test server not listening')
  return `http://127.0.0.1:${address.port}`
}

function queryFetch(path: string): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    headers: { 'x-ai-ide-token': ACCESS_TOKEN },
  })
}
