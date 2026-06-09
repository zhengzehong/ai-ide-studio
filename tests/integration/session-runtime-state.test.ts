import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-runtime-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('session runtime state', () => {
  test('closed sessions with running agent messages are reported as running', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-existing' })
    sessionStore.updateStatus(session.id, 'closed')
    messageStore.append(session.id, { role: 'agent', content: '', status: 'running' })

    const [listed] = sessionStore.listWithRuntimeState(agent.id)

    expect(listed).toMatchObject({
      id: session.id,
      status: 'closed',
      activity_state: 'running',
    })
  })
})
