import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { WebSocket, WebSocketServer } from 'ws'
import { handleWsConnection } from '../../src/gateway/ws-handler.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { projectSessionStatsStore } from '../../src/store/session-stats.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { turnProcessItemStore } from '../../src/store/turn-process-items.js'

let tmp = ''

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
    last: () => JSON.parse(sent.at(-1) || '{}') as {
      type: string
      requestId?: string
      data?: unknown
      message?: string
    },
  }
}

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-project-session-stats-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('project session stats store', () => {
  test('returns complete project stats without counting running sessions as unread', () => {
    const projectA = projectStore.create({ name: 'Project A' })
    const projectB = projectStore.create({ name: 'Project B' })
    const agentA = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: projectA.id })
    const globalAgent = agentStore.create({ name: 'Global', type: 'dev', runtime: 'mock' })
    const readAt = '2026-07-17T00:00:00.000Z'
    const messageAt = '2026-07-17T00:01:00.000Z'

    const activePrompt = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    sessionStore.markRead(activePrompt.id, readAt)
    sessionStore.touch(activePrompt.id, messageAt)

    const runningMessage = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    messageStore.append(runningMessage.id, { role: 'agent', content: '', status: 'running' })
    sessionStore.markRead(runningMessage.id, readAt)
    sessionStore.touch(runningMessage.id, messageAt)

    const runningProcess = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    const processMessage = messageStore.append(runningProcess.id, { role: 'agent', content: 'working' })
    turnProcessItemStore.upsert({
      id: 'tpi-running',
      sessionId: runningProcess.id,
      messageId: processMessage.id,
      kind: 'tool',
      status: 'in_progress',
      title: 'Running tool',
    })

    const unread = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    sessionStore.markRead(unread.id, readAt)
    sessionStore.touch(unread.id, messageAt)

    const read = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    sessionStore.touch(read.id, readAt)
    sessionStore.markRead(read.id, messageAt)

    const template = sessionStore.create({ agentId: agentA.id, projectId: projectA.id, isTemplate: true })
    sessionStore.markRead(template.id, readAt)
    sessionStore.touch(template.id, messageAt)

    const deleted = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    sessionStore.markRead(deleted.id, readAt)
    sessionStore.touch(deleted.id, messageAt)
    sessionStore.delete(deleted.id)

    const archived = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    sessionStore.markRead(archived.id, readAt)
    sessionStore.touch(archived.id, messageAt)
    sessionStore.archive(archived.id)

    const closed = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    sessionStore.markRead(closed.id, readAt)
    sessionStore.touch(closed.id, messageAt)
    sessionStore.updateStatus(closed.id, 'closed')

    const unscoped = sessionStore.create({ agentId: globalAgent.id })
    sessionStore.markRead(unscoped.id, readAt)
    sessionStore.touch(unscoped.id, messageAt)

    const statsByProject = Object.fromEntries(
      projectSessionStatsStore.list((sessionId) => sessionId === activePrompt.id)
        .map((stats) => [stats.projectId, stats]),
    )

    expect(statsByProject).toEqual({
      [projectA.id]: { projectId: projectA.id, sessionCount: 5, runningCount: 3, unreadCount: 1 },
      [projectB.id]: { projectId: projectB.id, sessionCount: 0, runningCount: 0, unreadCount: 0 },
    })
  })

  test('exposes the complete snapshot through sessions.projectStats', async () => {
    const project = projectStore.create({ name: 'Project' })
    const agent = agentStore.create({ name: 'Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    sessionStore.updateStage(session.id, '正在思考...')
    const ws = createWs()

    await ws.send({ type: 'sessions.projectStats', requestId: 'req-project-stats' })

    expect(ws.last()).toMatchObject({
      type: 'result',
      requestId: 'req-project-stats',
      data: {
        generatedAt: expect.any(String),
        items: [{ projectId: project.id, sessionCount: 1, runningCount: 1, unreadCount: 0 }],
      },
    })
  })
})
