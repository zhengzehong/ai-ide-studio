import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import Database from 'better-sqlite3'
import { messagePresentationsMigration } from '../../src/store/migrations/047-message-presentations.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-message-presentations-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('message preview presentations', () => {
  test('persists a lightweight preview summary without retaining the tool payload', () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const previewOutput = {
      previewId: 'prev-123',
      url: '/preview/prev-123/',
      title: 'Dashboard preview',
      target: 'pc',
      taskId: 'task-1',
      createdAt: '2026-07-23T00:00:00.000Z',
    }

    const row = messageStore.append(session.id, {
      role: 'agent',
      content: 'Done',
      toolCalls: [{
        id: 'tool-preview',
        title: 'mcp__ai-ide-tools__preview_publish',
        status: 'completed',
        rawOutput: [{ type: 'text', text: JSON.stringify(previewOutput) }],
      }],
    }) as unknown as { presentations_json?: string | null }

    expect(JSON.parse(row.presentations_json || '[]')).toEqual([{
      kind: 'preview',
      ...previewOutput,
    }])
  })

  test.each([
    {
      title: 'preview.publish',
      status: 'failed',
      rawOutput: JSON.stringify({ previewId: 'prev-failed', title: 'Failed', target: 'pc', createdAt: '2026-07-23T00:00:00.000Z' }),
    },
    {
      title: 'preview.publish',
      status: 'completed',
      rawOutput: JSON.stringify({ error: 'publish failed' }),
    },
    {
      title: 'other.tool',
      status: 'completed',
      rawOutput: JSON.stringify({ previewId: 'prev-other', title: 'Other', target: 'pc', createdAt: '2026-07-23T00:00:00.000Z' }),
    },
  ])('does not persist invalid or unsuccessful preview output %#', (toolCall) => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const row = messageStore.append(session.id, {
      role: 'agent',
      content: 'Done',
      toolCalls: [{ id: 'tool-preview', ...toolCall }],
    }) as unknown as { presentations_json?: string | null }

    expect(row.presentations_json ?? null).toBeNull()
  })

  test('migration backfills existing preview process items without reading unrelated tool details', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE messages (id TEXT PRIMARY KEY);
      CREATE TABLE turn_process_items (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT,
        detail_json TEXT
      );
      INSERT INTO messages (id) VALUES ('msg-preview'), ('msg-unrelated');
    `)
    const previewOutput = {
      previewId: 'prev-legacy',
      url: '/preview/prev-legacy/',
      title: 'Legacy preview',
      target: 'pc',
      taskId: null,
      createdAt: '2026-07-22T00:00:00.000Z',
    }
    db.prepare(`
      INSERT INTO turn_process_items (id, message_id, kind, title, detail_json)
      VALUES (?, ?, 'tool', ?, ?)
    `).run('tpi-preview', 'msg-preview', 'preview.publish', JSON.stringify({
      id: 'tool-preview',
      title: 'preview.publish',
      status: 'completed',
      rawOutput: JSON.stringify(previewOutput),
    }))
    db.prepare(`
      INSERT INTO turn_process_items (id, message_id, kind, title, detail_json)
      VALUES (?, ?, 'tool', ?, ?)
    `).run('tpi-unrelated', 'msg-unrelated', 'Terminal', '{not valid json')

    messagePresentationsMigration.up(db)

    const rows = db.prepare<[], { id: string; presentations_json: string | null }>(
      'SELECT id, presentations_json FROM messages ORDER BY id',
    ).all()
    expect(JSON.parse(rows[0].presentations_json || '[]')).toEqual([{
      kind: 'preview',
      ...previewOutput,
    }])
    expect(rows[1].presentations_json).toBeNull()
    db.close()
  })
})
