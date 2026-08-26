import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkerWriteDataPort, type WorkerWriteDataPort } from '../../src/data-worker/writer-worker/client.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'

let writer: WorkerWriteDataPort | undefined
let directory: string | undefined

afterEach(async () => {
  await writer?.close()
  writer = undefined
  closeDatabase()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('Writer retention operations', () => {
  it('runs inspection and deletion through the background Writer queue', async () => {
    directory = mkdtempSync(resolve(tmpdir(), 'ai-ide-retention-worker-'))
    const dbPath = resolve(directory, 'test.sqlite')
    initDatabase(dbPath)
    const session = sessionStore.create({ agentId: 'agent-worker-retention' })
    seedMessage(session.id, 'worker-eligible', '2026-08-01T00:00:00.000Z', true)
    for (let index = 0; index < 15; index += 1) {
      seedMessage(session.id, `worker-protected-${index}`, `2026-08-25T${String(index).padStart(2, '0')}:00:00.000Z`)
    }
    closeDatabase()
    writer = await createWorkerWriteDataPort({ dbPath })

    await expect(
      writer.inspectRetention({
        cutoff: '2026-08-19T00:00:00.000Z',
        keepTurns: 15,
      }),
    ).resolves.toMatchObject({ eligibleMessages: 1, processRows: 1, eventRows: 1 })
    await writer.runRetentionBatch({
      cutoff: '2026-08-19T00:00:00.000Z',
      keepTurns: 15,
      batchRows: 500,
    })
    await writer.runRetentionBatch({
      cutoff: '2026-08-19T00:00:00.000Z',
      keepTurns: 15,
      batchRows: 500,
    })

    const readonly = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      expect(readonly.prepare('SELECT COUNT(*) AS count FROM messages').get()).toEqual({ count: 16 })
      expect(readonly.prepare('SELECT process_item_count FROM messages WHERE id = ?').get('worker-eligible')).toEqual({
        process_item_count: 0,
      })
      expect(
        readonly.prepare('SELECT COUNT(*) AS count FROM session_events WHERE message_id = ?').get('worker-eligible'),
      ).toEqual({ count: 0 })
    } finally {
      readonly.close()
    }
  })
})

function seedMessage(sessionId: string, id: string, timestamp: string, withDetails = false): void {
  messageStore.append(sessionId, { id, role: 'agent', content: `final ${id}`, status: 'completed' })
  getDb()
    .prepare(
      `
    UPDATE messages SET timestamp = ?, completed_at = ?, process_item_count = ? WHERE id = ?
  `,
    )
    .run(timestamp, timestamp, withDetails ? 1 : 0, id)
  if (!withDetails) return
  getDb()
    .prepare(
      `
    INSERT INTO turn_process_items (
      id, session_id, message_id, sequence, kind, status, content, created_at, updated_at
    ) VALUES (?, ?, ?, 1, 'thinking', 'completed', 'detail', ?, ?)
  `,
    )
    .run(`${id}-process`, sessionId, id, timestamp, timestamp)
  getDb()
    .prepare(
      `
    INSERT INTO session_events (
      id, session_id, message_id, type, role, payload_json, sequence, created_at
    ) VALUES (?, ?, ?, 'thinking.chunk', 'agent', '{}', 1, ?)
  `,
    )
    .run(`${id}-event`, sessionId, id, timestamp)
}
