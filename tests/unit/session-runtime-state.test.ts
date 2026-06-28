import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore, messageStore } from '../../src/store/sessions.js'
import { turnProcessItemStore } from '../../src/store/turn-process-items.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-runtime-state-'))
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('session runtime state', () => {
  test('marks a session running when its latest agent message is still running', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    messageStore.append(session.id, { role: 'human', content: 'start' })
    messageStore.append(session.id, { id: 'msg-running', role: 'agent', content: '', status: 'running' })

    const [listed] = sessionStore.listWithRuntimeState(undefined, undefined, () => false)

    expect(listed.id).toBe(session.id)
    expect(listed.activity_state).toBe('running')
  })

  test('marks a session running when the active prompt registry says it is running', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    const [listed] = sessionStore.listWithRuntimeState(undefined, undefined, (sessionId) => sessionId === session.id)

    expect(listed.activity_state).toBe('running')
  })

  test('marks a session idle when it has no running evidence', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    messageStore.append(session.id, { role: 'agent', content: 'done', status: 'completed' })

    const [listed] = sessionStore.listWithRuntimeState(undefined, undefined, () => false)

    expect(listed.id).toBe(session.id)
    expect(listed.activity_state).toBe('idle')
  })

  test('startup recovery clears stale running messages before runtime inference', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    sessionStore.updateStage(session.id, '正在思考...')
    messageStore.append(session.id, { role: 'human', content: 'start' })
    const running = messageStore.append(session.id, { id: 'msg-stale-running', role: 'agent', content: 'partial', status: 'running' })
    const item = turnProcessItemStore.upsert({
      id: 'tpi-stale-running',
      sessionId: session.id,
      messageId: running.id,
      kind: 'tool',
      status: 'running',
      title: 'tool',
    })

    sessionStore.reconcileInterruptedStages()

    expect(messageStore.get(running.id)?.status).not.toBe('running')
    expect(turnProcessItemStore.get(item.id)?.status).not.toBe('running')
    expect(sessionStore.listWithRuntimeState(undefined, undefined, () => false)[0]?.activity_state).toBe('idle')
  })
})
