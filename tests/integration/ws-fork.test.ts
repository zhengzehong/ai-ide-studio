import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { acpHost } from '../../src/acp/host.js'
import { handleWsConnection } from '../../src/gateway/ws-handler.js'
import type { WebSocket, WebSocketServer } from 'ws'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-ws-fork-'))
beforeAll(() => { mkdirSync(tmp, { recursive: true }); initDatabase(resolve(tmp, 'test.sqlite')) })
afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

function createWs() {
  const handlers = new Map<string, (raw?: unknown) => unknown>()
  const sent: string[] = []
  const ws = {
    OPEN: 1, readyState: 1,
    send(payload: string) { sent.push(payload) },
    on(event: string, handler: (raw?: unknown) => unknown) { handlers.set(event, handler) },
  } as unknown as WebSocket
  handleWsConnection(ws, {} as never, {} as WebSocketServer)
  const onMessage = handlers.get('message')!
  return { sent, send: async (msg: unknown) => Promise.resolve(onMessage(Buffer.from(JSON.stringify(msg)))) }
}

describe('session.fork WS RPC', () => {
  test('fork 会话并分配新的 ACP session', async () => {
    const workDir = resolve(tmp, 'project-fork')
    const project = projectStore.create({ name: 'Fork 项目', workDir })
    agentStore.upsert({ id: 'agent-fork', type: 'dev', name: 'Fork 测试', runtime: 'mock', projectId: project.id })
    const source = sessionStore.create({ agentId: 'agent-fork', acpSessionId: 'acp-source', projectId: project.id })
    const calls: Array<{ projectId?: string; cwd?: string }> = []

    const original = acpHost.forkSession
    acpHost.forkSession = (async (_agentId, _sourceSessionId, targetSessionId, context) => {
      calls.push({ projectId: context?.projectId, cwd: context?.cwd })
      return `acp-${targetSessionId}`
    }) as typeof acpHost.forkSession

    const ws = createWs()
    await ws.send({ type: 'session.fork', requestId: 'req-fork', sessionId: source.id })
    const response = JSON.parse(ws.sent.at(-1) || '{}')
    expect(response.type).toBe('result')
    expect(response.requestId).toBe('req-fork')
    expect(response.data.id).toBeTruthy()
    expect(response.data.agent_id).toBe('agent-fork')
    expect(response.data.project_id).toBe(project.id)
    expect(response.data.acp_session_id).toBe(`acp-${response.data.id}`)
    expect(sessionStore.get(response.data.id)?.acp_session_id).toBe(`acp-${response.data.id}`)
    expect(sessionStore.get(response.data.id)?.project_id).toBe(project.id)
    expect(calls).toEqual([{ projectId: project.id, cwd: workDir }])

    acpHost.forkSession = original
  })
})
