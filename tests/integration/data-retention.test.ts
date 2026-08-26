import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectRetention, runRetentionBatch } from '../../src/data-worker/writer-worker/retention.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'

const NOW = Date.parse('2026-08-26T00:00:00.000Z')
const CUTOFF = '2026-08-19T00:00:00.000Z'
let directory: string

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ai-ide-retention-'))
  initDatabase(resolve(directory, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
})

describe('data retention', () => {
  it('keeps the latest fifteen turns and excludes exactly seven days and non-completed turns', () => {
    const session = sessionStore.create({ agentId: 'agent-a' })
    addCompletedTurn(session.id, 'eligible-oldest', NOW - 20 * day())
    addCompletedTurn(session.id, 'exactly-seven-days', NOW - 7 * day())
    for (let index = 0; index < 15; index += 1) {
      addCompletedTurn(session.id, `recent-${index}`, NOW - index * 60_000)
    }
    addTurn(session.id, 'failed-old', NOW - 30 * day(), 'failed')
    addTurn(session.id, 'cancelled-old', NOW - 30 * day(), 'cancelled')
    addTurn(session.id, 'running-old', NOW - 30 * day(), 'running')
    const otherSession = sessionStore.create({ agentId: 'agent-b' })
    for (let index = 0; index < 15; index += 1) {
      addCompletedTurn(otherSession.id, `other-${index}`, NOW - (30 + index) * day())
    }

    const result = inspectRetention(getDb(), { cutoff: CUTOFF, keepTurns: 15 })

    expect(result).toMatchObject({ eligibleMessages: 1, processRows: 1, eventRows: 1 })
  })

  it('deletes at most five hundred derived rows, process rows before events, and never messages', () => {
    const session = sessionStore.create({ agentId: 'agent-batch' })
    addCompletedTurn(session.id, 'eligible-batch', NOW - 40 * day(), 600, 600)
    for (let index = 0; index < 15; index += 1) {
      addCompletedTurn(session.id, `protected-${index}`, NOW - index * 60_000)
    }
    const beforeMessages = messageCount()

    const first = runRetentionBatch(getDb(), { cutoff: CUTOFF, keepTurns: 15, batchRows: 500 })
    expect(first).toMatchObject({ deletedProcessRows: 500, deletedEventRows: 0, hasMore: true })
    expect(derivedCounts('eligible-batch')).toEqual({ process: 100, events: 600, processCount: 0 })

    const second = runRetentionBatch(getDb(), { cutoff: CUTOFF, keepTurns: 15, batchRows: 500 })
    expect(second).toMatchObject({ deletedProcessRows: 100, deletedEventRows: 400, hasMore: true })
    const third = runRetentionBatch(getDb(), { cutoff: CUTOFF, keepTurns: 15, batchRows: 500 })
    expect(third).toMatchObject({ deletedProcessRows: 0, deletedEventRows: 200, hasMore: true })
    expect(runRetentionBatch(getDb(), { cutoff: CUTOFF, keepTurns: 15, batchRows: 500 })).toMatchObject({
      messageId: null,
      hasMore: false,
    })
    expect(derivedCounts('eligible-batch')).toEqual({ process: 0, events: 0, processCount: 0 })
    expect(messageCount()).toBe(beforeMessages)
    expect(messageStore.get('eligible-batch')?.content).toBe('final eligible-batch')
  })

  it('dry-run and repeated batches recalculate safely without changing message facts', () => {
    const session = sessionStore.create({ agentId: 'agent-resume' })
    addCompletedTurn(session.id, 'eligible-resume', NOW - 40 * day(), 2, 2)
    for (let index = 0; index < 15; index += 1) {
      addCompletedTurn(session.id, `resume-protected-${index}`, NOW - index * 60_000)
    }
    const before = inspectRetention(getDb(), { cutoff: CUTOFF, keepTurns: 15 })
    expect(before).toMatchObject({ eligibleMessages: 1, processRows: 2, eventRows: 2 })
    expect(derivedCounts('eligible-resume')).toMatchObject({ process: 2, events: 2 })

    runRetentionBatch(getDb(), { cutoff: CUTOFF, keepTurns: 15, batchRows: 1 })
    const afterInterrupt = inspectRetention(getDb(), { cutoff: CUTOFF, keepTurns: 15 })
    expect(afterInterrupt).toMatchObject({ eligibleMessages: 1, processRows: 1, eventRows: 2 })

    while (runRetentionBatch(getDb(), { cutoff: CUTOFF, keepTurns: 15, batchRows: 1 }).hasMore) {
      // Simulates restart by recalculating eligibility on every batch.
    }
    expect(messageStore.get('eligible-resume')).toMatchObject({ status: 'completed', content: 'final eligible-resume' })
    expect(inspectRetention(getDb(), { cutoff: CUTOFF, keepTurns: 15 })).toMatchObject({
      eligibleMessages: 0,
      processRows: 0,
      eventRows: 0,
    })
  })
})

function addCompletedTurn(sessionId: string, id: string, timestamp: number, processRows = 1, eventRows = 1): void {
  addTurn(sessionId, id, timestamp, 'completed', processRows, eventRows)
}

function addTurn(
  sessionId: string,
  id: string,
  timestamp: number,
  status: string,
  processRows = 1,
  eventRows = 1,
): void {
  const iso = new Date(timestamp).toISOString()
  messageStore.append(sessionId, { id, role: 'agent', content: `final ${id}`, status })
  getDb()
    .prepare(
      `
    UPDATE messages SET timestamp = ?, completed_at = ?, status = ?, process_item_count = ? WHERE id = ?
  `,
    )
    .run(iso, iso, status, processRows, id)
  const insertProcess = getDb().prepare(`
    INSERT INTO turn_process_items (
      id, session_id, message_id, sequence, kind, status, content, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'thinking', 'completed', 'detail', ?, ?)
  `)
  for (let index = 0; index < processRows; index += 1) {
    insertProcess.run(`${id}-process-${index}`, sessionId, id, index + 1, iso, iso)
  }
  const insertEvent = getDb().prepare(`
    INSERT INTO session_events (
      id, session_id, message_id, type, role, payload_json, sequence, created_at
    ) VALUES (?, ?, ?, 'thinking.chunk', 'agent', '{"content":"detail"}', ?, ?)
  `)
  for (let index = 0; index < eventRows; index += 1) {
    insertEvent.run(`${id}-event-${index}`, sessionId, id, index + 1, iso)
  }
}

function derivedCounts(messageId: string): { process: number; events: number; processCount: number } {
  const process =
    getDb()
      .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM turn_process_items WHERE message_id = ?')
      .get(messageId)?.count ?? 0
  const events =
    getDb()
      .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM session_events WHERE message_id = ?')
      .get(messageId)?.count ?? 0
  const processCount =
    getDb()
      .prepare<[string], { process_item_count: number }>('SELECT process_item_count FROM messages WHERE id = ?')
      .get(messageId)?.process_item_count ?? -1
  return { process, events, processCount }
}

function messageCount(): number {
  return getDb().prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM messages').get()?.count ?? 0
}

function day(): number {
  return 24 * 60 * 60 * 1000
}
