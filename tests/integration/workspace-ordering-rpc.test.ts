import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { WebSocket, WebSocketServer } from 'ws'
import { handleWsConnection } from '../../src/gateway/ws-handler.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-workspace-ordering-rpc-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
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
  return {
    send: async (msg: unknown) => Promise.resolve(onMessage(Buffer.from(JSON.stringify(msg)))),
    last: () => JSON.parse(sent.at(-1) || '{}') as { type: string; requestId?: string; data?: unknown; message?: string },
  }
}

describe('Workspace ordering RPC', () => {
  test('reorders project agents and rejects agents outside the project', async () => {
    const project = projectStore.create({ name: 'Ordering A', workDir: resolve(tmp, 'a') })
    const otherProject = projectStore.create({ name: 'Ordering B', workDir: resolve(tmp, 'b') })
    const first = agentStore.create({ type: 'dev', name: 'First', runtime: 'mock', projectId: project.id })
    const second = agentStore.create({ type: 'dev', name: 'Second', runtime: 'mock', projectId: project.id })
    const third = agentStore.create({ type: 'dev', name: 'Third', runtime: 'mock', projectId: project.id })
    const outsider = agentStore.create({ type: 'dev', name: 'Outsider', runtime: 'mock', projectId: otherProject.id })
    const ws = createWs()

    await ws.send({ type: 'agents.reorder', requestId: 'req-agents-order', projectId: project.id, agentIds: [third.id, first.id, second.id] })
    expect(ws.last().type).toBe('result')
    expect((ws.last().data as Array<{ id: string }>).map((agent) => agent.id)).toEqual([third.id, first.id, second.id])

    await ws.send({ type: 'agents.reorder', requestId: 'req-agents-outside', projectId: project.id, agentIds: [outsider.id, first.id] })
    expect(ws.last().type).toBe('error')
    expect(ws.last().message).toContain('Agent does not belong to project')
  })

  test('reorders agent sessions and rejects sessions outside the agent', async () => {
    const project = projectStore.create({ name: 'Ordering', workDir: resolve(tmp, 'ordering') })
    const agent = agentStore.create({ type: 'dev', name: 'Agent', runtime: 'mock', projectId: project.id })
    const otherAgent = agentStore.create({ type: 'dev', name: 'Other', runtime: 'mock', projectId: project.id })
    const first = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const second = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const third = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const outsider = sessionStore.create({ agentId: otherAgent.id, projectId: project.id })
    const ws = createWs()

    await ws.send({ type: 'sessions.reorder', requestId: 'req-sessions-order', projectId: project.id, agentId: agent.id, sessionIds: [third.id, first.id, second.id] })
    expect(ws.last().type).toBe('result')
    expect((ws.last().data as Array<{ id: string }>).map((session) => session.id)).toEqual([third.id, first.id, second.id])

    await ws.send({ type: 'sessions.reorder', requestId: 'req-sessions-outside', projectId: project.id, agentId: agent.id, sessionIds: [outsider.id, first.id] })
    expect(ws.last().type).toBe('error')
    expect(ws.last().message).toContain('Session does not belong to agent/project')
  })
})
