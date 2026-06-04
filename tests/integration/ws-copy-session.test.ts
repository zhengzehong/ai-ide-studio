import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'
import { acpHost } from '../../src/acp/host.js'
import { handleWsConnection } from '../../src/gateway/ws-handler.js'
import type { WebSocket, WebSocketServer } from 'ws'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-ws-copy-'))

beforeAll(() => {
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterAll(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function createWs() {
  const handlers = new Map<string, (raw?: unknown) => unknown>()
  const sent: string[] = []
  const ws = {
    OPEN: 1,
    readyState: 1,
    send(payload: string) { sent.push(payload) },
    on(event: string, handler: (raw?: unknown) => unknown) { handlers.set(event, handler) },
  } as unknown as WebSocket
  handleWsConnection(ws, {} as never, {} as WebSocketServer)
  const onMessage = handlers.get('message')!
  return { sent, send: async (msg: unknown) => Promise.resolve(onMessage(Buffer.from(JSON.stringify(msg)))) }
}

function setMessageTimestamp(messageId: string, timestamp: string): void {
  getDb().prepare('UPDATE messages SET timestamp = ? WHERE id = ?').run(timestamp, messageId)
}

describe('sessions.copy WS RPC', () => {
  test('copies runtime session and only the latest 10 messages with matching events', async () => {
    const workDir = resolve(tmp, 'project-copy')
    const project = projectStore.create({ name: 'Copy 项目', workDir })
    agentStore.upsert({ id: 'agent-copy', type: 'dev', name: 'Copy 测试', runtime: 'mock', projectId: project.id })
    const source = sessionStore.create({ agentId: 'agent-copy', acpSessionId: 'acp-source-copy', projectId: project.id })
    const sourceMessageIds: string[] = []

    for (let index = 1; index <= 12; index += 1) {
      const timestamp = `2026-06-04T00:${String(index).padStart(2, '0')}:00.000Z`
      const message = messageStore.append(source.id, {
        role: index % 2 === 0 ? 'agent' : 'human',
        content: `message-${index}`,
        thinking: index % 2 === 0 ? `thinking-${index}` : undefined,
        toolCalls: index % 2 === 0 ? [{ id: `tool-${index}`, title: `Tool ${index}`, status: 'completed' }] : undefined,
      })
      setMessageTimestamp(message.id, timestamp)
      sourceMessageIds.push(message.id)
      eventStore.append(source.id, {
        type: index % 2 === 0 ? 'message.chunk' : 'message.user',
        agentId: 'agent-copy',
        acpSessionId: 'acp-source-copy',
        messageId: message.id,
        role: message.role,
        payload: { messageId: message.id, content: message.content },
      })
    }
    eventStore.append(source.id, {
      type: 'usage.update',
      agentId: 'agent-copy',
      acpSessionId: 'acp-source-copy',
      role: 'agent',
      payload: { usage: { contextSize: 100, contextUsed: 20 } },
    })

    const calls: Array<{ sourceSessionId: string; targetSessionId: string; projectId?: string; cwd?: string }> = []
    const ensureCalls: Array<{ sessionId: string; acpSessionId?: string | null }> = []
    const originalEnsureSession = acpHost.ensureSession
    const original = acpHost.forkSession
    acpHost.ensureSession = (async (_agentId, sessionId, acpSessionId) => {
      ensureCalls.push({ sessionId, acpSessionId })
      return acpSessionId ?? 'acp-restored-source'
    }) as typeof acpHost.ensureSession
    acpHost.forkSession = (async (_agentId, sourceSessionId, targetSessionId, context) => {
      calls.push({ sourceSessionId, targetSessionId, projectId: context?.projectId, cwd: context?.cwd })
      return `acp-${targetSessionId}`
    }) as typeof acpHost.forkSession

    try {
      const ws = createWs()
      await ws.send({ type: 'sessions.copy', requestId: 'req-copy', sessionId: source.id })
      const response = JSON.parse(ws.sent.at(-1) || '{}')
      expect(response.type).toBe('result')
      expect(response.requestId).toBe('req-copy')
      expect(response.data.id).toBeTruthy()
      expect(response.data.id).not.toBe(source.id)
      expect(response.data.agent_id).toBe('agent-copy')
      expect(response.data.project_id).toBe(project.id)
      expect(response.data.acp_session_id).toBe(`acp-${response.data.id}`)
      expect(response.data.task_id).toBeNull()

      expect(ensureCalls).toEqual([{ sessionId: source.id, acpSessionId: 'acp-source-copy' }])
      expect(calls).toEqual([{
        sourceSessionId: source.id,
        targetSessionId: response.data.id,
        projectId: project.id,
        cwd: workDir,
      }])

      const copiedMessages = messageStore.list(response.data.id, { includeToolCalls: true })
      expect(copiedMessages).toHaveLength(10)
      expect(copiedMessages.map((message) => message.content)).toEqual([
        'message-3',
        'message-4',
        'message-5',
        'message-6',
        'message-7',
        'message-8',
        'message-9',
        'message-10',
        'message-11',
        'message-12',
      ])
      expect(copiedMessages.every((message) => message.session_id === response.data.id)).toBe(true)
      expect(copiedMessages.some((message) => sourceMessageIds.includes(message.id))).toBe(false)

      const copiedEvents = eventStore.list(response.data.id, { limit: 50 })
      expect(copiedEvents).toHaveLength(10)
      expect(copiedEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      const copiedMessageIds = new Set(copiedMessages.map((message) => message.id))
      expect(copiedEvents.every((event) => event.session_id === response.data.id)).toBe(true)
      expect(copiedEvents.every((event) => event.message_id && copiedMessageIds.has(event.message_id))).toBe(true)
      expect(copiedEvents.every((event) => {
        const payload = JSON.parse(event.payload_json) as { messageId?: string }
        return !!payload.messageId && copiedMessageIds.has(payload.messageId)
      })).toBe(true)
    } finally {
      acpHost.ensureSession = originalEnsureSession
      acpHost.forkSession = original
    }
  })
})
