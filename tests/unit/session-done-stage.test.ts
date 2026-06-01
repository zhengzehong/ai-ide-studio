import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { events } from '../../src/core/events.js'
import '../../src/core/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-done-stage-'))
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('session done stage cleanup', () => {
  test('clears running stage when a turn is done', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    sessionStore.updateStage(session.id, '正在思考...')

    events.emit('session:done', { sessionId: session.id, agentId: agent.id, messageId: 'done-1', stopReason: 'end_turn' })

    expect(sessionStore.get(session.id)?.stage).toBe('')
  })
})
