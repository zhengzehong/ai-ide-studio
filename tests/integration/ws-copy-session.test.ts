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
  test('returns a copying placeholder and forks runtime without resuming source', async () => {
    const workDir = resolve(tmp, 'project-copy')
    const project = projectStore.create({ name: 'Copy 项目', workDir })
    agentStore.upsert({ id: 'agent-copy', type: 'dev', name: 'Copy 测试', runtime: 'mock', projectId: project.id })
    const source = sessionStore.create({ agentId: 'agent-copy', acpSessionId: 'acp-source-copy', projectId: project.id })
    sessionStore.updateTitle(source.id, 'Source Session')
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

    const calls: Array<{ sourceAcpSessionId: string; targetSessionId: string; projectId?: string; cwd?: string }> = []
    const ensureCalls: Array<{ sessionId: string; acpSessionId?: string | null }> = []
    let releaseFork!: () => void
    const forkStarted = new Promise<void>((resolveStarted) => {
      releaseFork = resolveStarted
    })
    const originalEnsureSession = acpHost.ensureSession
    const original = acpHost.forkSessionFromAcpSessionId
    acpHost.ensureSession = (async (_agentId, sessionId, acpSessionId) => {
      ensureCalls.push({ sessionId, acpSessionId })
      return acpSessionId ?? 'acp-restored-source'
    }) as typeof acpHost.ensureSession
    acpHost.forkSessionFromAcpSessionId = (async (_agentId, sourceAcpSessionId, targetSessionId, context) => {
      calls.push({ sourceAcpSessionId, targetSessionId, projectId: context?.projectId, cwd: context?.cwd })
      await forkStarted
      return `acp-${targetSessionId}`
    }) as typeof acpHost.forkSessionFromAcpSessionId

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
      expect(response.data.acp_session_id).toBeNull()
      expect(response.data.task_id).toBeNull()
      expect(response.data.title).toBe('Fork from Source Session')
      expect(response.data.stage).toBe('正在复制会话...')

      expect(ensureCalls).toEqual([])
      expect(calls).toEqual([{
        sourceAcpSessionId: 'acp-source-copy',
        targetSessionId: response.data.id,
        projectId: project.id,
        cwd: workDir,
      }])
      expect(sessionStore.get(response.data.id)?.acp_session_id).toBeNull()

      releaseFork()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const copied = sessionStore.get(response.data.id)
      expect(copied?.acp_session_id).toBe(`acp-${response.data.id}`)
      expect(copied?.stage).toBe('')
      expect(copied?.title).toBe('Fork from Source Session')

      expect(sourceMessageIds).toHaveLength(12)
      expect(messageStore.list(response.data.id, { includeToolCalls: true })).toHaveLength(0)
      expect(eventStore.list(response.data.id, { limit: 50 })).toHaveLength(0)
      expect(getDb().prepare('SELECT COUNT(*) AS count FROM turn_process_items WHERE session_id = ?').get(response.data.id)).toEqual({ count: 0 })
    } finally {
      acpHost.ensureSession = originalEnsureSession
      acpHost.forkSessionFromAcpSessionId = original
    }
  })
})
