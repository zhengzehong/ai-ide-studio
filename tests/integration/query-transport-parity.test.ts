import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { localQueryPort } from '../../src/queries/local-query-port.js'
import { taskRpcHandlers } from '../../src/gateway/rpc/tasks.js'
import { sessionRpcHandlers } from '../../src/gateway/rpc/sessions.js'
import { sessionRecoveryRpcHandlers } from '../../src/gateway/rpc/session-recovery.js'
import type { RpcContext, RpcHandlerMap } from '../../src/gateway/rpc/types.js'
import { taskStore } from '../../src/store/tasks.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-query-parity-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('legacy WebSocket query adapters', () => {
  test('tasks.list delegates filters to QueryPort', async () => {
    const listTasks = vi.spyOn(localQueryPort, 'listTasks').mockResolvedValue([])

    await callRpc(taskRpcHandlers, 'tasks.list', {
      status: 'running',
      projectId: 'project-a',
    })

    expect(listTasks).toHaveBeenCalledWith({ status: 'running', projectId: 'project-a' })
  })

  test('tasks.page preserves page filters and metadata', async () => {
    const page = { items: [], total: 0, hasMore: false, nextCursor: null }
    const listTaskPage = vi.spyOn(localQueryPort, 'listTaskPage').mockResolvedValue(page)

    const result = await callRpc(taskRpcHandlers, 'tasks.page', {
      projectId: 'project-a',
      createdBefore: '2026-08-26T00:00:00.000Z',
      excludeTerminal: true,
      limit: 50,
      cursor: 'task-before',
    })

    expect(listTaskPage).toHaveBeenCalledWith({
      projectId: 'project-a',
      status: undefined,
      query: undefined,
      createdFrom: undefined,
      createdBefore: '2026-08-26T00:00:00.000Z',
      excludeTerminal: true,
      limit: 50,
      cursor: 'task-before',
    })
    expect(result).toEqual(page)
  })

  test('sessions.list delegates filters to QueryPort', async () => {
    const listSessions = vi.spyOn(localQueryPort, 'listSessions').mockResolvedValue([])

    await callRpc(sessionRpcHandlers, 'sessions.list', {
      agentId: 'agent-a',
      projectId: 'project-a',
    })

    expect(listSessions).toHaveBeenCalledWith({ agentId: 'agent-a', projectId: 'project-a' })
  })

  test('sessions.messages unwraps the QueryPort page for WS compatibility', async () => {
    const item = { id: 'message-a' }
    const listMessages = vi.spyOn(localQueryPort, 'listSessionMessages').mockResolvedValue({
      items: [item as never],
      hasMore: true,
      nextCursor: 'cursor-a',
    })

    const result = await callRpc(sessionRpcHandlers, 'sessions.messages', {
      sessionId: 'session-a',
      limit: 20,
      before: '2026-07-19T00:00:00.000Z',
      includeToolCalls: false,
      includeLatestToolCalls: true,
    })

    expect(listMessages).toHaveBeenCalledWith({
      sessionId: 'session-a',
      limit: 20,
      before: '2026-07-19T00:00:00.000Z',
      includeToolCalls: false,
      includeLatestToolCalls: true,
    })
    expect(result).toEqual([item])
  })

  test('sessions.events unwraps the QueryPort page for WS compatibility', async () => {
    const item = { id: 'event-a' }
    const listEvents = vi.spyOn(localQueryPort, 'listSessionEvents').mockResolvedValue({
      items: [item as never],
      hasMore: true,
      nextCursor: '12',
    })

    const result = await callRpc(sessionRpcHandlers, 'sessions.events', {
      sessionId: 'session-a',
      limit: 10,
      afterSequence: 2,
    })

    expect(listEvents).toHaveBeenCalledWith({
      sessionId: 'session-a',
      limit: 10,
      afterSequence: 2,
    })
    expect(result).toEqual([item])
  })
})

describe('QueryPort and WS response parity', () => {
  test('returns identical task, session, message, and event arrays', async () => {
    const projectId = 'project-parity'
    const task = taskStore.create({ title: 'Parity task', description: 'Parity task', projectId })
    const session = sessionStore.create({ agentId: 'agent-parity', taskId: task.id, projectId })
    messageStore.append(session.id, { role: 'user', content: 'hello' })
    eventStore.append(session.id, {
      type: 'message.user',
      messageId: 'message-user',
      payload: { content: 'hello' },
    })

    const queryTasks = await localQueryPort.listTasks({ projectId })
    const querySessions = await localQueryPort.listSessions({ projectId, agentId: 'agent-parity' })
    const queryMessages = await localQueryPort.listSessionMessages({ sessionId: session.id, limit: 20 })
    const queryEvents = await localQueryPort.listSessionEvents({ sessionId: session.id, limit: 20 })

    expect(await callRpc(taskRpcHandlers, 'tasks.list', { projectId })).toEqual(queryTasks)
    expect(await callRpc(sessionRpcHandlers, 'sessions.list', {
      projectId,
      agentId: 'agent-parity',
    })).toEqual(querySessions)
    expect(await callRpc(sessionRpcHandlers, 'sessions.messages', {
      sessionId: session.id,
      limit: 20,
    })).toEqual(queryMessages.items)
    expect(await callRpc(sessionRpcHandlers, 'sessions.events', {
      sessionId: session.id,
      limit: 20,
    })).toEqual(queryEvents.items)
  })

  test('recovery excludes mirrored history while retaining the full stream cursor', async () => {
    const session = sessionStore.create({ agentId: 'agent-recovery-parity' })
    eventStore.append(session.id, {
      type: 'tool.update',
      messageId: 'message-a',
      payload: { rawOutput: 'large output' },
    })
    eventStore.append(session.id, {
      type: 'session:capabilities',
      payload: { currentModeId: 'plan' },
    })

    const recovery = await localQueryPort.getSessionRecovery({ sessionId: session.id, limit: 20 })

    expect(recovery.latestSequence).toBe(2)
    expect(recovery.events.map((event) => event.type)).toEqual(['session:capabilities'])
    expect(await callRpc(sessionRecoveryRpcHandlers, 'sessions.recovery', { sessionId: session.id, limit: 20 })).toEqual(recovery)
  })

  test('serves the team member state without shipping history events', async () => {
    const session = sessionStore.create({ agentId: 'agent-a', projectId: 'project-a' })
    eventStore.append(session.id, { type: 'permission.request', payload: { permissionRequest: { id: 'perm-1', toolCall: {}, options: [] } } })
    eventStore.append(session.id, { type: 'usage.update', payload: { usage: { contextSize: 100 } } })
    eventStore.append(session.id, { type: 'message.user', payload: { content: 'hi' } })

    const state = await callRpc(sessionRecoveryRpcHandlers, 'sessions.teamMemberState', { sessionId: session.id }) as Record<string, unknown>

    expect(state).toEqual({
      sessionId: session.id,
      latestSequence: 3,
      usage: { contextSize: 100 },
      pendingPermissions: [expect.objectContaining({ id: 'perm-1' })],
      pendingElicitations: [],
    })
    // 轻量端点契约:不回历史事件(旧 sessions.recovery 的 500 条在这里没有位置)
    expect(state).not.toHaveProperty('events')
  })

  test('rejects guest team member state requests before reading a session', async () => {
    const query = vi.spyOn(localQueryPort, 'getTeamMemberState')
    await expect(sessionRecoveryRpcHandlers['sessions.teamMemberState']({ type: 'sessions.teamMemberState', sessionId: 'private' }, {
      state: { authMode: 'guest', subscriptions: new Set() }, sendResult: vi.fn(), sendError: vi.fn(), sendOutOfBandError: vi.fn(),
    })).rejects.toThrow('仅所有者')
    expect(query).not.toHaveBeenCalled()
  })

  test('rejects guest recovery requests before reading a session', async () => {
    const query = vi.spyOn(localQueryPort, 'getSessionRecovery')
    await expect(sessionRecoveryRpcHandlers['sessions.recovery']({ type: 'sessions.recovery', sessionId: 'private' }, {
      state: { authMode: 'guest', subscriptions: new Set() }, sendResult: vi.fn(), sendError: vi.fn(), sendOutOfBandError: vi.fn(),
    })).rejects.toThrow('仅所有者')
    expect(query).not.toHaveBeenCalled()
  })
})

describe('turn event recovery page budget', () => {
  function seedTurn(messageId: string, count: number): string {
    const session = sessionStore.create({ agentId: 'agent-page-budget' })
    messageStore.append(session.id, { id: messageId, role: 'agent', content: '', status: 'running' })
    for (let index = 0; index < count; index += 1) {
      eventStore.append(session.id, { type: 'message.chunk', messageId, payload: { contentDelta: `chunk-${index}` } })
    }
    return session.id
  }

  test('keeps the historical page budget when the client sends none (PC unchanged)', async () => {
    const messageId = 'message-default-budget'
    const sessionId = seedTurn(messageId, 130)

    const page = await callRpc(sessionRecoveryRpcHandlers, 'sessions.messageEventsPage', { sessionId, messageId }) as { items: unknown[]; hasMore: boolean; nextSequence: number }

    expect(page.items).toHaveLength(100)
    expect(page.hasMore).toBe(true)
  })

  test('honors the wider mobile budget and clamps anything beyond the server ceiling', async () => {
    const messageId = 'message-wide-budget'
    const sessionId = seedTurn(messageId, 130)

    const wide = await callRpc(sessionRecoveryRpcHandlers, 'sessions.messageEventsPage', { sessionId, messageId, maxItems: 500, maxBytes: 512 * 1024 }) as { items: unknown[]; hasMore: boolean }
    expect(wide.items).toHaveLength(130)
    expect(wide.hasMore).toBe(false)

    const clamped = await callRpc(sessionRecoveryRpcHandlers, 'sessions.messageEventsPage', { sessionId, messageId, maxItems: 5000, maxBytes: 8 * 1024 * 1024 }) as { items: unknown[]; hasMore: boolean }
    expect(clamped.items).toHaveLength(130)
    expect(clamped.hasMore).toBe(false)
  })

  test('rejects an invalid page budget instead of silently paging', async () => {
    const messageId = 'message-invalid-budget'
    const sessionId = seedTurn(messageId, 1)

    await expect(callRpc(sessionRecoveryRpcHandlers, 'sessions.messageEventsPage', { sessionId, messageId, maxItems: 0 })).rejects.toThrow('分页预算无效')
    await expect(callRpc(sessionRecoveryRpcHandlers, 'sessions.messageEventsPage', { sessionId, messageId, maxBytes: -1 })).rejects.toThrow('分页预算无效')
  })
})

async function callRpc(
  handlers: RpcHandlerMap,
  type: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  let result: unknown
  let error: string | null = null
  const context: RpcContext = {
    state: { subscriptions: new Set(), authMode: 'owner' },
    sendResult: (data) => { result = data },
    sendError: (message) => { error = message },
    sendOutOfBandError: (message) => { error = message },
  }
  await handlers[type]({ type, ...input } as never, context)
  if (error) throw new Error(error)
  return result
}
