import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { sessionPersistencePort } from '../../src/core/persistence/session-persistence-port.js'
import { setWriteDataPort } from '../../src/core/persistence/write-data-port-provider.js'
import {
  createWorkerWriteDataPort,
  type WorkerWriteDataPort,
} from '../../src/data-worker/writer-worker/client.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { eventStore, sessionStore } from '../../src/store/sessions.js'

let tmp: string
let writer: WorkerWriteDataPort | undefined
let resetWritePort: (() => void) | undefined

beforeEach(async () => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-cursor-'))
  const dbPath = resolve(tmp, 'test.sqlite')
  initDatabase(dbPath)
  writer = await createWorkerWriteDataPort({ dbPath })
  resetWritePort = setWriteDataPort(writer)
  sessionPersistencePort.reset()
})

afterEach(async () => {
  resetWritePort?.()
  resetWritePort = undefined
  await writer?.close()
  writer = undefined
  sessionPersistencePort.reset()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('session persistence cursor seed', () => {
  test('continues an existing event cursor and uses committed done sequence as outbox version', async () => {
    const session = sessionStore.create({ agentId: 'agent-existing' })
    for (let index = 1; index <= 5; index += 1) {
      eventStore.append(session.id, {
        type: 'message.chunk',
        agentId: session.agent_id,
        messageId: 'message-existing',
        role: 'agent',
        payload: { contentDelta: String(index) },
      })
    }

    const chunk = await sessionPersistencePort.appendEvent(session.id, {
      type: 'message.chunk',
      agentId: session.agent_id,
      messageId: 'message-new',
      role: 'agent',
      payload: { contentDelta: 'next' },
    })
    const done = await sessionPersistencePort.appendEvent(session.id, {
      type: 'message.done',
      agentId: session.agent_id,
      messageId: 'message-new',
      role: 'agent',
      payload: { stopReason: 'end_turn' },
    }, 'critical')

    expect(chunk.sequence).toBe(6)
    expect(done.sequence).toBe(7)
    const batches = getDb().prepare<[string], { first_sequence: number }>(`
      SELECT first_sequence FROM writer_batch_commits
      WHERE session_id = ? ORDER BY rowid ASC
    `).all(session.id)
    expect(batches.map((batch) => batch.first_sequence)).toEqual([6, 7])
    expect(getDb().prepare<[string], { version: number }>(`
      SELECT version FROM outbox_events WHERE session_id = ?
    `).get(session.id)).toEqual({ version: done.sequence })
  })
})
