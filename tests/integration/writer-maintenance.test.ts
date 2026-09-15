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

  it('按保留窗口清理 writer_batch_commits,并保留窗口内行', async () => {
    seedBatchCommitRows({ old: 3, fresh: 2 })
    writer = await createWorkerWriteDataPort({
      dbPath,
      walCheckpointBytes: Number.MAX_SAFE_INTEGER,
      batchCommitRetentionMs: 7 * 24 * 60 * 60 * 1000,
    })

    const result = await writer.maintain({ force: false })
    expect(result.deletedBatchCommitRows).toBe(3)
    expect(result.batchCommitPruneExhausted).toBe(false)
    expect(result.phasesMs.batchCommitPruneMs).toBeGreaterThanOrEqual(0)
    expect(typeof result.phasesMs.outboxDeleteMs).toBe('number')

    usingDatabase((db) => {
      const ids = db
        .prepare<[], { batch_id: string }>('SELECT batch_id FROM writer_batch_commits ORDER BY batch_id')
        .all()
        .map((row) => row.batch_id)
      expect(ids).toEqual(['fresh-batch-1', 'fresh-batch-2'])
    })
  })

  it('达到单次清理上限时标记 exhausted 并留到下一轮', async () => {
    seedBatchCommitRows({ old: 5, fresh: 0 })
    writer = await createWorkerWriteDataPort({
      dbPath,
      walCheckpointBytes: Number.MAX_SAFE_INTEGER,
      batchCommitRetentionMs: 7 * 24 * 60 * 60 * 1000,
      batchCommitPruneRows: 2,
    })

    const result = await writer.maintain({ force: false })
    expect(result.deletedBatchCommitRows).toBe(2)
    expect(result.batchCommitPruneExhausted).toBe(true)
    usingDatabase((db) => {
      expect(db.prepare('SELECT COUNT(*) AS count FROM writer_batch_commits').get()).toEqual({ count: 3 })
    })
  })

  it('保留窗口为 0 时完全不清理', async () => {
    seedBatchCommitRows({ old: 2, fresh: 0 })
    writer = await createWorkerWriteDataPort({
      dbPath,
      walCheckpointBytes: Number.MAX_SAFE_INTEGER,
      batchCommitRetentionMs: 0,
    })

    const result = await writer.maintain({ force: false })
    expect(result.deletedBatchCommitRows).toBe(0)
    usingDatabase((db) => {
      expect(db.prepare('SELECT COUNT(*) AS count FROM writer_batch_commits').get()).toEqual({ count: 2 })
    })
  })
})

function seedBatchCommitRows(input: { old: number; fresh: number }): void {
  // beforeEach 已关闭应用连接,这里直接用文件连接播种(worker 尚未启动,无写锁竞争)。
  const db = new Database(dbPath)
  try {
    const insert = db.prepare(`
      INSERT INTO writer_batch_commits (batch_id, session_id, stream_generation, first_sequence, last_sequence, committed_at)
      VALUES (?, ?, 'generation-maintenance', 1, 1, ?)
    `)
    for (let index = 1; index <= input.old; index += 1) {
      insert.run(`old-batch-${index}`, sessionId, '2000-01-01T00:00:00.000Z')
    }
    for (let index = 1; index <= input.fresh; index += 1) {
      insert.run(`fresh-batch-${index}`, sessionId, new Date().toISOString())
    }
  } finally {
    db.close()
  }
}

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
