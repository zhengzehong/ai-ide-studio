import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { events } from '../../src/core/events.js'
import { sessionDockRpcHandlers } from '../../src/gateway/rpc/session-dock.js'
import type { RpcAuthMode, RpcContext } from '../../src/gateway/rpc/types.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-dock-'))

beforeEach(() => {
  closeDatabase()
  initDatabase(resolve(tmp, `test-${Date.now()}-${Math.random()}.sqlite`))
})

afterEach(() => closeDatabase())
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('global Session dock RPC', () => {
  test('uses the latest session event sequence for completion state', async () => {
    const { regular, agent } = createSessions()
    const firstDone = eventStore.append(regular.id, {
      type: 'message.done',
      agentId: agent.id,
      messageId: 'first-done',
      role: 'agent',
      payload: { messageId: 'first-done', stopReason: 'end_turn' },
    })
    const latestDone = eventStore.append(regular.id, {
      type: 'message.done',
      agentId: agent.id,
      messageId: 'latest-done',
      role: 'agent',
      payload: { messageId: 'latest-done', stopReason: 'end_turn' },
    })
    getDb().prepare('UPDATE session_events SET created_at = ? WHERE id = ?')
      .run('2026-08-03T00:00:00.000Z', firstDone.id)
    getDb().prepare('UPDATE session_events SET created_at = ? WHERE id = ?')
      .run('2026-08-01T00:00:00.000Z', latestDone.id)
    getDb().prepare('UPDATE sessions SET last_read_at = ? WHERE id = ?')
      .run('2026-08-02T00:00:00.000Z', regular.id)

    await callRpc('sessionDock.add', { sessionId: regular.id })
    const listed = await callRpc('sessionDock.list') as Array<Record<string, unknown>>

    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ unread: false })
  })

  test('adds ordinary project Sessions and keeps add idempotent', async () => {
    const { regular } = createSessions()
    const updates: Array<{ action: string; sessionId?: string }> = []
    const onUpdate = (event: { action: 'added' | 'removed' | 'reordered'; sessionId?: string }): void => {
      updates.push(event)
    }
    events.on('session-dock:update', onUpdate)

    const added = await callRpc('sessionDock.add', { sessionId: regular.id }) as Record<string, unknown>
    await callRpc('sessionDock.add', { sessionId: regular.id })
    const listed = await callRpc('sessionDock.list') as Array<Record<string, unknown>>

    events.off('session-dock:update', onUpdate)
    expect(added).toMatchObject({ sessionId: regular.id, projectName: 'Dock Project', agentName: 'Dock Agent' })
    expect(listed).toHaveLength(1)
    expect(updates).toEqual([{ action: 'added', sessionId: regular.id }])
  })

  test('searches across projects and excludes invalid or already docked Sessions', async () => {
    const { regular, second, autonomous } = createSessions()
    await callRpc('sessionDock.add', { sessionId: regular.id })

    const candidates = await callRpc('sessionDock.search', { query: 'second' }) as Array<Record<string, unknown>>
    const allCandidates = await callRpc('sessionDock.search', { query: '' }) as Array<Record<string, unknown>>

    expect(candidates).toMatchObject([{ sessionId: second.id, sessionTitle: 'Second Session' }])
    expect(allCandidates.map((item) => item.sessionId)).toEqual([second.id])
    await expect(callRpc('sessionDock.add', { sessionId: autonomous.id })).rejects.toThrow('不能加入')
  })

  test('returns running and unread state and persists explicit ordering', async () => {
    const { regular, second } = createSessions()
    messageStore.append(regular.id, { role: 'agent', content: 'completed answer', status: 'completed' })
    sessionStore.touch(regular.id, '2026-08-05T06:00:00.000Z')
    getDb().prepare('UPDATE messages SET timestamp = ?, completed_at = ? WHERE session_id = ?')
      .run('2026-08-05T06:00:00.000Z', '2026-08-05T06:00:00.000Z', regular.id)
    getDb().prepare('UPDATE sessions SET last_read_at = ? WHERE id = ?')
      .run('2026-08-05T05:00:00.000Z', regular.id)
    messageStore.append(second.id, { role: 'agent', content: 'working', status: 'running' })

    await callRpc('sessionDock.add', { sessionId: regular.id })
    await callRpc('sessionDock.add', { sessionId: second.id })
    const reordered = await callRpc('sessionDock.reorder', { sessionIds: [regular.id, second.id] }) as Array<Record<string, unknown>>

    expect(reordered.map((item) => item.sessionId)).toEqual([regular.id, second.id])
    expect(reordered[0]).toMatchObject({ unread: true, activityState: 'idle', sortOrder: 1 })
    expect(reordered[1]).toMatchObject({ unread: false, activityState: 'running', sortOrder: 2 })
  })

  test('prunes archived entries before reordering the remaining dock', async () => {
    const { regular, second } = createSessions()
    await callRpc('sessionDock.add', { sessionId: regular.id })
    await callRpc('sessionDock.add', { sessionId: second.id })
    sessionStore.archive(second.id)

    const reordered = await callRpc('sessionDock.reorder', { sessionIds: [regular.id] }) as Array<Record<string, unknown>>
    const listed = await callRpc('sessionDock.list') as Array<Record<string, unknown>>

    expect(reordered.map((item) => item.sessionId)).toEqual([regular.id])
    expect(listed.map((item) => item.sessionId)).toEqual([regular.id])
  })

  test('rejects guest access', async () => {
    await expect(callRpc('sessionDock.list', {}, 'guest')).rejects.toThrow('访客无权访问')
  })
})

function createSessions() {
  const project = projectStore.create({ name: 'Dock Project', workDir: 'D:/work/dock' })
  const agent = agentStore.create({ name: 'Dock Agent', type: 'dev', runtime: 'mock', projectId: project.id })
  const regular = sessionStore.create({ agentId: agent.id, projectId: project.id, title: 'Primary Session' })
  const second = sessionStore.create({ agentId: agent.id, projectId: project.id, title: 'Second Session' })
  const autonomous = sessionStore.create({ agentId: agent.id, projectId: project.id, purpose: 'autonomy' })
  const template = sessionStore.create({ agentId: agent.id, projectId: project.id, isTemplate: true })
  const archived = sessionStore.create({ agentId: agent.id, projectId: project.id, title: 'Archived Session' })
  sessionStore.archive(archived.id)
  sessionStore.create({ agentId: agent.id, title: 'Global Session' })
  expect(template.is_template).toBe(1)
  return { project, agent, regular, second, autonomous }
}

async function callRpc(
  type: keyof typeof sessionDockRpcHandlers,
  input: Record<string, unknown> = {},
  authMode: RpcAuthMode = 'owner',
): Promise<unknown> {
  let result: unknown
  await sessionDockRpcHandlers[type]({ type, ...input }, {
    state: { subscriptions: new Set(), authMode },
    sendResult: (data) => { result = data },
    sendError: (message) => { throw new Error(message) },
    sendOutOfBandError: (message) => { throw new Error(message) },
  } satisfies RpcContext)
  return result
}
