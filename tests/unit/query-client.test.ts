import { describe, expect, test, vi } from 'vitest'
import {
  createHttpQueryClient,
  createWsQueryClient,
  resolveQueryTransport,
} from '../../ui/src/services/query-client.ts'

describe('HTTP query client', () => {
  test('encodes task filters and sends the local access token in a header', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: [{ id: 'task-a', title: 'Task A' }],
    }))
    const client = createHttpQueryClient({
      fetchImpl,
      getAccessToken: () => 'local-secret',
    })

    const tasks = await client.listTasks({ projectId: 'project / A', status: 'running' })

    expect(tasks).toEqual([{ id: 'task-a', title: 'Task A' }])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/v1/tasks?projectId=project+%2F+A&status=running')
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
      'x-ai-ide-token': 'local-secret',
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  test('parses explicit message page metadata and boolean options', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: [{ id: 'message-a', timestamp: '2026-07-19T00:00:00.000Z' }],
      page: { hasMore: true, nextCursor: '2026-07-18T00:00:00.000Z' },
    }))
    const client = createHttpQueryClient({ fetchImpl, getAccessToken: () => '' })

    const page = await client.listSessionMessages({
      sessionId: 'session / A',
      limit: 20,
      before: '2026-07-19T00:00:00.000Z',
      includeToolCalls: false,
      includeLatestToolCalls: true,
    })

    expect(page).toEqual({
      items: [{ id: 'message-a', timestamp: '2026-07-19T00:00:00.000Z' }],
      hasMore: true,
      nextCursor: '2026-07-18T00:00:00.000Z',
    })
    expect(fetchImpl.mock.calls[0][0]).toBe(
      '/api/v1/sessions/session%20%2F%20A/messages?limit=20&before=2026-07-19T00%3A00%3A00.000Z&includeToolCalls=false&includeLatestToolCalls=true',
    )
  })

  test('parses a lightweight session recovery snapshot', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: {
        sessionId: 'session-a',
        latestSequence: 42,
        events: [{ id: 'event-a', type: 'session:capabilities', sequence: 40 }],
      },
    }))
    const client = createHttpQueryClient({ fetchImpl, getAccessToken: () => '' })

    const recovery = await client.getSessionRecovery({ sessionId: 'session / A', limit: 100 })

    expect(fetchImpl.mock.calls[0][0]).toBe(
      '/api/v1/sessions/session%20%2F%20A/recovery?limit=100',
    )
    expect(recovery).toMatchObject({
      sessionId: 'session-a',
      latestSequence: 42,
      events: [{ id: 'event-a' }],
    })
  })

  test('surfaces the server error message without discarding the old store snapshot', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
      { error: 'Query Worker unavailable' },
      503,
    ))
    const client = createHttpQueryClient({ fetchImpl, getAccessToken: () => '' })

    await expect(client.listSessions({ projectId: 'project-a' }))
      .rejects.toThrow('Query Worker unavailable')
  })

  test('aborts a query when its deadline expires', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const client = createHttpQueryClient({
      fetchImpl,
      getAccessToken: () => '',
      timeoutMs: 5,
    })

    try {
      await client.listTasks({})
      throw new Error('expected query to time out')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('查询超时')
      expect((error as Error).cause).toBeInstanceOf(DOMException)
    }
  })
})

describe('WS rollback query client', () => {
  test('drops interaction events from turns completed before the recovery boundary', async () => {
    const request = vi.fn(async (): Promise<unknown> => [
      { id: 'permission-old', type: 'permission.request', sequence: 1 },
      { id: 'done', type: 'message.done', sequence: 2 },
      { id: 'permission-active', type: 'permission.request', sequence: 3 },
    ])
    const client = createWsQueryClient(request)

    const recovery = await client.getSessionRecovery({ sessionId: 'session-a', limit: 20 })

    expect(recovery.latestSequence).toBe(3)
    expect(recovery.events.map((event) => event.id)).toEqual(['permission-active'])
  })

  test('keeps legacy RPC shapes and derives compatibility page metadata', async () => {
    const request = vi.fn(async (message: Record<string, unknown>): Promise<unknown> => {
      if (message.type === 'sessions.messages') {
        return [
          { id: 'message-a', timestamp: '2026-07-19T00:00:00.000Z' },
          { id: 'message-b', timestamp: '2026-07-19T00:00:01.000Z' },
        ]
      }
      return []
    })
    const client = createWsQueryClient(request)

    const page = await client.listSessionMessages({ sessionId: 'session-a', limit: 2 })

    expect(request).toHaveBeenCalledWith({
      type: 'sessions.messages',
      sessionId: 'session-a',
      limit: 2,
    })
    expect(page).toMatchObject({
      hasMore: true,
      nextCursor: '2026-07-19T00:00:00.000Z',
    })
  })

  test('selects HTTP by default and WS only for test or explicit rollback', () => {
    expect(resolveQueryTransport('production', undefined)).toBe('http')
    expect(resolveQueryTransport('development', undefined)).toBe('http')
    expect(resolveQueryTransport('production', 'ws')).toBe('ws')
    expect(resolveQueryTransport('test', undefined)).toBe('ws')
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
