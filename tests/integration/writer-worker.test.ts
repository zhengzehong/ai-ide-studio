import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'
import {
  createWorkerWriteDataPort,
  type WorkerWriteDataPort,
} from '../../src/data-worker/writer-worker/client.js'
import type {
  OutboxEventInput,
  WriteBatch,
  WriteMutation,
} from '../../src/ports/write-data-port.js'

let tmp: string
let dbPath: string
let writer: WorkerWriteDataPort | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-writer-worker-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
})

afterEach(async () => {
  await writer?.close()
  writer = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Writer Worker', () => {
  it('commits 30 concurrent session batches with atomic outbox rows', async () => {
    const sessions = Array.from({ length: 30 }, (_, index) => sessionStore.create({
      agentId: `agent-${index}`,
      projectId: `project-${index % 3}`,
    }))
    closeDatabase()
    writer = await createWorkerWriteDataPort({ dbPath })

    const results = await Promise.all(sessions.map((session, index) => writer?.commitBatch({
      batchId: `batch-${index}`,
      priority: 'background',
      sessionId: session.id,
      streamGeneration: 'generation-1',
      firstSequence: 1,
      lastSequence: 1,
      mutations: [
        sessionEvent(`event-${index}`, session.id, `content-${index}`),
        { type: 'outbox.enqueue', event: outbox(`outbox-${index}`, session.id, index + 1) },
      ],
    })))

    expect(results).toHaveLength(30)
    expect(results.every((result) => result?.duplicate === false)).toBe(true)
    usingDatabase((db) => {
      expect(db.prepare('SELECT COUNT(*) AS count FROM session_events').get()).toEqual({ count: 30 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM outbox_events').get()).toEqual({ count: 30 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM writer_batch_commits').get()).toEqual({ count: 30 })
    })
  })

  it('deduplicates a retried batchId without applying mutations twice', async () => {
    const session = sessionStore.create({ agentId: 'agent-dedup' })
    closeDatabase()
    writer = await createWorkerWriteDataPort({ dbPath })
    const batch = writeBatch('batch-dedup', session.id, 1, [
      sessionEvent('event-dedup', session.id, 'once'),
    ])

    const first = await writer.commitBatch(batch)
    const second = await writer.commitBatch(batch)

    expect(first.duplicate).toBe(false)
    expect(second).toMatchObject({ batchId: batch.batchId, duplicate: true })
    usingDatabase((db) => {
      expect(db.prepare('SELECT COUNT(*) AS count FROM session_events WHERE id = ?').get('event-dedup'))
        .toEqual({ count: 1 })
    })
  })

  it('rejects overlapping sequence ranges but permits a new generation', async () => {
    const session = sessionStore.create({ agentId: 'agent-order' })
    closeDatabase()
    writer = await createWorkerWriteDataPort({ dbPath })

    await writer.commitBatch(writeBatch('batch-order-1', session.id, 1, [
      sessionEvent('event-order-1', session.id, 'first'),
    ]))
    await expect(writer.commitBatch(writeBatch('batch-order-overlap', session.id, 1, [
      sessionEvent('event-order-overlap', session.id, 'overlap'),
    ]))).rejects.toMatchObject({ code: 'ORDER_CONFLICT' })
    await expect(writer.commitBatch({
      ...writeBatch('batch-order-generation-2', session.id, 1, [
        sessionEvent('event-order-generation-2', session.id, 'new generation'),
      ]),
      streamGeneration: 'generation-2',
    })).resolves.toMatchObject({ duplicate: false })
  })

  it('flushes pending background work for a session before its critical batch', async () => {
    const session = sessionStore.create({ agentId: 'agent-critical' })
    closeDatabase()
    writer = await createWorkerWriteDataPort({ dbPath })

    const background = writer.commitBatch(writeBatch('batch-background', session.id, 1, [
      sessionEvent('event-background', session.id, 'background'),
    ]))
    const critical = writer.commitBatch({
      ...writeBatch('batch-critical', session.id, 2, [
        sessionEvent('event-critical', session.id, 'critical'),
      ]),
      priority: 'critical',
    })
    await Promise.all([background, critical])

    usingDatabase((db) => {
      const rows = db.prepare<[], { batch_id: string }>(
        'SELECT batch_id FROM writer_batch_commits ORDER BY rowid ASC',
      ).all()
      expect(rows.map((row) => row.batch_id)).toEqual(['batch-background', 'batch-critical'])
    })
  })

  it('rolls back business, batch, and outbox rows when one mutation fails', async () => {
    const session = sessionStore.create({ agentId: 'agent-rollback' })
    const originalUpdatedAt = session.updated_at
    closeDatabase()
    writer = await createWorkerWriteDataPort({ dbPath })
    const duplicateEventId = 'event-rollback-duplicate'

    await expect(writer.commitBatch(writeBatch('batch-rollback', session.id, 1, [
      { type: 'session.touch', sessionId: session.id, timestamp: '2026-07-19T10:00:00.000Z' },
      sessionEvent(duplicateEventId, session.id, 'first'),
      sessionEvent(duplicateEventId, session.id, 'duplicate'),
      { type: 'outbox.enqueue', event: outbox('outbox-rollback', session.id, 1) },
    ]))).rejects.toMatchObject({ code: 'SQLITE_ERROR' })

    usingDatabase((db) => {
      expect(db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(session.id))
        .toEqual({ updated_at: originalUpdatedAt })
      expect(db.prepare('SELECT COUNT(*) AS count FROM session_events WHERE id = ?').get(duplicateEventId))
        .toEqual({ count: 0 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM outbox_events WHERE id = ?').get('outbox-rollback'))
        .toEqual({ count: 0 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM writer_batch_commits WHERE batch_id = ?').get('batch-rollback'))
        .toEqual({ count: 0 })
    })
  })

  it('rejects after termination and can restart against the same WAL database', async () => {
    const session = sessionStore.create({ agentId: 'agent-restart' })
    closeDatabase()
    writer = await createWorkerWriteDataPort({ dbPath })
    await writer.terminate()

    await expect(writer.commitBatch(writeBatch('batch-after-stop', session.id, 1, [
      sessionEvent('event-after-stop', session.id, 'stopped'),
    ]))).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })

    writer = await createWorkerWriteDataPort({ dbPath })
    await expect(writer.commitBatch(writeBatch('batch-after-restart', session.id, 1, [
      sessionEvent('event-after-restart', session.id, 'restarted'),
    ]))).resolves.toMatchObject({ duplicate: false })
  })
})

function writeBatch(
  batchId: string,
  sessionId: string,
  sequence: number,
  mutations: WriteMutation[],
): WriteBatch {
  return {
    batchId,
    priority: 'background',
    sessionId,
    streamGeneration: 'generation-1',
    firstSequence: sequence,
    lastSequence: sequence,
    mutations,
  }
}

function sessionEvent(id: string, sessionId: string, content: string): WriteMutation {
  return {
    type: 'session.event.append',
    event: {
      id,
      sessionId,
      agentId: 'agent-writer',
      messageId: `message-${id}`,
      eventType: 'message.chunk',
      role: 'agent',
      payload: { content },
      createdAt: '2026-07-19T09:00:00.000Z',
    },
  }
}

function outbox(id: string, sessionId: string, version: number): OutboxEventInput {
  return {
    id,
    topic: 'session.changed',
    aggregateType: 'session',
    aggregateId: sessionId,
    sessionId,
    version,
    payload: { sessionId },
    createdAt: '2026-07-19T09:00:00.000Z',
  }
}

function usingDatabase(assertions: (db: ReturnType<typeof Database>) => void): void {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    assertions(db)
  } finally {
    db.close()
  }
}
