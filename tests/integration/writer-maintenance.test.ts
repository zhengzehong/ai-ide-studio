import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkerWriteDataPort, type WorkerWriteDataPort } from '../../src/data-worker/writer-worker/client.js'
import type { WriteBatch } from '../../src/ports/write-data-port.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'

let tmp: string
let dbPath: string
let sessionId: string
let writer: WorkerWriteDataPort | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-writer-maintenance-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
  const session = sessionStore.create({ agentId: 'agent-maintenance' })
  sessionId = session.id
  messageStore.append(sessionId, { role: 'user', content: 'keep me' })
  eventStore.append(sessionId, { type: 'message.user', payload: { content: 'keep me' } })
  seedOutboxRows()
  closeDatabase()
})

afterEach(async () => {
  await writer?.close()
  writer = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Writer-owned SQLite maintenance', () => {
  it('drains pending writes, skips a small WAL, optimizes, and only prunes old published Outbox rows', async () => {
    writer = await createWorkerWriteDataPort({
      dbPath,
      walCheckpointBytes: Number.MAX_SAFE_INTEGER,
      publishedOutboxRetentionMs: 7 * 24 * 60 * 60 * 1000,
    })
    const pendingCommit = writer.commitBatch(backgroundBatch('batch-before-maintenance'))
    const maintenance = writer.maintain({ force: false })

    await expect(pendingCommit).resolves.toMatchObject({ duplicate: false })
    await expect(maintenance).resolves.toMatchObject({
      checkpointAttempted: false,
      checkpointMode: 'none',
      optimized: true,
      deletedPublishedOutboxRows: 1,
    })

    usingDatabase((db) => {
      expect(db.prepare('SELECT COUNT(*) AS count FROM writer_batch_commits').get()).toEqual({ count: 1 })
      expect(db.prepare('SELECT id FROM outbox_events ORDER BY id').all()).toEqual([
        { id: 'outbox-old-unpublished' },
        { id: 'outbox-recent-published' },
      ])
      expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get(sessionId)).toEqual({
        count: 1,
      })
      expect(db.prepare('SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?').get(sessionId)).toEqual({
        count: 2,
      })
    })
  })

  it('checkpoints above the WAL threshold and truncates on a forced shutdown pass', async () => {
    writer = await createWorkerWriteDataPort({ dbPath, walCheckpointBytes: 1 })
    await writer.commitBatch(backgroundBatch('batch-wal-growth'))

    await expect(writer.maintain({ force: false })).resolves.toMatchObject({
      checkpointAttempted: true,
      checkpointMode: 'passive',
    })
    await expect(writer.maintain({ force: true })).resolves.toMatchObject({
      checkpointAttempted: true,
      checkpointMode: 'truncate',
      optimized: true,
    })
  })
})

function backgroundBatch(batchId: string): WriteBatch {
  return {
    batchId,
    priority: 'background',
    sessionId,
    streamGeneration: 'generation-maintenance',
    firstSequence: 2,
    lastSequence: 2,
    mutations: [
      {
        type: 'session.event.append',
        event: {
          id: `event-${batchId}`,
          sessionId,
          eventType: 'message.chunk',
          messageId: `message-${batchId}`,
          role: 'agent',
          payload: { content: batchId },
          createdAt: new Date().toISOString(),
        },
      },
    ],
  }
}

function seedOutboxRows(): void {
  const insert = getDb().prepare(`
    INSERT INTO outbox_events (
      id, topic, aggregate_type, aggregate_id, session_id, version,
      payload_json, created_at, published_at
    ) VALUES (?, 'session.changed', 'session', ?, ?, 1, '{}', ?, ?)
  `)
  insert.run('outbox-old-published', sessionId, sessionId, '2000-01-01T00:00:00.000Z', '2000-01-02T00:00:00.000Z')
  insert.run('outbox-old-unpublished', sessionId, sessionId, '2000-01-01T00:00:00.000Z', null)
  const recent = new Date().toISOString()
  insert.run('outbox-recent-published', sessionId, sessionId, recent, recent)
}

function usingDatabase(assertions: (db: ReturnType<typeof Database>) => void): void {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    assertions(db)
  } finally {
    db.close()
  }
}
