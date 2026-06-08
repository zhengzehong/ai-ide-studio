import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { events } from '../../src/core/events.js'
import { widgetRpcHandlers } from '../../src/gateway/rpc/widget.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-widget-'))

beforeEach(() => {
  closeDatabase()
  initDatabase(resolve(tmp, `test-${Date.now()}-${Math.random()}.sqlite`))
})

afterEach(() => {
  closeDatabase()
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

async function callWidgetRpc(type: string, msg: Record<string, unknown> = {}): Promise<unknown> {
  const handler = widgetRpcHandlers[type]
  if (!handler) throw new Error(`Missing handler: ${type}`)

  return new Promise((resolveResult, reject) => {
    const context: RpcContext = {
      state: { subscriptions: new Set() },
      sendResult: resolveResult,
      sendError: (message) => reject(new Error(message)),
      sendOutOfBandError: (message) => reject(new Error(message)),
    }
    Promise.resolve(handler({ type, ...msg }, context)).catch(reject)
  })
}

describe('widget session RPC', () => {
  test('lists running sessions from persisted runtime state instead of agent runtime status', async () => {
    const project = projectStore.create({ name: 'Widget Project', workDir: 'D:/work/widget' })
    const agent = agentStore.create({ name: 'Codex', type: 'dev', runtime: 'mock', projectId: project.id, icon: 'code' })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { id: 'msg-running-widget', role: 'agent', content: 'partial output', status: 'running' })

    const rows = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: session.id,
      agentId: agent.id,
      agentName: 'Codex',
      agentIcon: 'code',
      projectId: project.id,
      projectName: 'Widget Project',
      activityState: 'running',
      stage: '',
      unread: false,
    })
  })

  test('reports idle runtime state when a session finishes', async () => {
    const project = projectStore.create({ name: 'Done Project', workDir: 'D:/work/done' })
    const agent = agentStore.create({ name: 'Done Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    events.emit('session:done', {
      sessionId: session.id,
      agentId: agent.id,
      messageId: 'done-without-idle',
      stopReason: 'end_turn',
    })

    const rows = await callWidgetRpc('widget.sessions.list', { filter: 'all' }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: session.id,
      activityState: 'idle',
    })
  })

  test('lists unread completed sessions and markRead hides them from active filter', async () => {
    const project = projectStore.create({ name: 'Unread Project', workDir: 'D:/work/unread' })
    const agent = agentStore.create({ name: 'Claude', type: 'dev', runtime: 'mock', projectId: project.id })
    const task = taskStore.create({ title: '修复登录问题', projectId: project.id, assignAgentId: agent.id })
    const session = sessionStore.create({ agentId: agent.id, taskId: task.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: '已经修复', status: 'completed' })
    sessionStore.touch(session.id)
    events.emit('session:done', {
      sessionId: session.id,
      agentId: agent.id,
      messageId: 'msg-done',
      stopReason: 'end_turn',
    })

    const unreadRows = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>

    expect(unreadRows).toHaveLength(1)
    expect(unreadRows[0]).toMatchObject({
      sessionId: session.id,
      taskId: task.id,
      taskTitle: '修复登录问题',
      activityState: 'idle',
      unread: true,
    })

    await callWidgetRpc('widget.sessions.markRead', { sessionId: session.id })
    const afterRead = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>

    expect(afterRead).toEqual([])
  })

  test('uses message.done events as unread completion fallback', async () => {
    const project = projectStore.create({ name: 'Event Project', workDir: 'D:/work/event' })
    const agent = agentStore.create({ name: 'Event Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })

    eventStore.append(session.id, {
      type: 'message.done',
      agentId: agent.id,
      messageId: 'done-event',
      role: 'agent',
      payload: { messageId: 'done-event', stopReason: 'end_turn' },
    })

    const rows = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: session.id,
      unread: true,
      activityState: 'idle',
    })
  })

  test('uses the newer message.done event when it is later than the latest agent message', async () => {
    const project = projectStore.create({ name: 'Later Event Project', workDir: 'D:/work/later-event' })
    const agent = agentStore.create({ name: 'Later Event Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const message = messageStore.append(session.id, { role: 'agent', content: 'message before read', status: 'completed' })
    getDb()
      .prepare('UPDATE messages SET timestamp = ?, completed_at = ? WHERE id = ?')
      .run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', message.id)
    getDb()
      .prepare('INSERT INTO widget_read_state (session_id, read_at) VALUES (?, ?)')
      .run(session.id, '2026-01-01T00:00:01.000Z')
    const doneEvent = eventStore.append(session.id, {
      type: 'message.done',
      agentId: agent.id,
      messageId: 'done-after-read',
      role: 'agent',
      payload: { messageId: 'done-after-read', stopReason: 'end_turn' },
    })
    getDb()
      .prepare('UPDATE session_events SET created_at = ? WHERE id = ?')
      .run('2026-01-01T00:00:02.000Z', doneEvent.id)

    const rows = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: session.id,
      completedAt: '2026-01-01T00:00:02.000Z',
      unread: true,
    })
  })

  test('filters sessions by project', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: 'D:/work/a' })
    const projectB = projectStore.create({ name: 'B', workDir: 'D:/work/b' })
    const agentA = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: projectA.id })
    const agentB = agentStore.create({ name: 'Agent B', type: 'dev', runtime: 'mock', projectId: projectB.id })
    const sessionA = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    const sessionB = sessionStore.create({ agentId: agentB.id, projectId: projectB.id })
    getDb()
      .prepare('INSERT INTO widget_read_state (session_id, read_at) VALUES (?, ?)')
      .run(sessionA.id, '2000-01-01T00:00:00.000Z')
    messageStore.append(sessionA.id, { role: 'agent', content: 'A done', status: 'completed' })
    sessionStore.touch(sessionA.id)
    messageStore.append(sessionB.id, { role: 'agent', content: 'B done', status: 'completed' })
    sessionStore.touch(sessionB.id)

    const rows = await callWidgetRpc('widget.sessions.list', { projectId: projectA.id }) as Array<Record<string, unknown>>

    expect(rows.map((row) => row.sessionId)).toEqual([sessionA.id])
  })

  test('does not list archived sessions', async () => {
    const project = projectStore.create({ name: 'Archived Project', workDir: 'D:/work/archived' })
    const agent = agentStore.create({ name: 'Archived Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: 'done before archive', status: 'completed' })
    sessionStore.touch(session.id)
    sessionStore.archive(session.id)

    const activeRows = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>
    const allRows = await callWidgetRpc('widget.sessions.list', { filter: 'all' }) as Array<Record<string, unknown>>

    expect(activeRows).toEqual([])
    expect(allRows).toEqual([])
  })
})
