import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import Database from 'better-sqlite3'
import { messagePresentationsMigration } from '../../src/store/migrations/047-message-presentations.js'
import { messagePresentationRepairMigration } from '../../src/store/migrations/048-message-presentation-repair.js'

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

  test('deduplicates repeated preview tool results by previewId', () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const toolCall = {
      id: 'tool-preview',
      title: 'preview.publish',
      status: 'completed',
      rawOutput: JSON.stringify({
        previewId: 'prev-duplicate',
        url: '/preview/prev-duplicate/',
        title: 'Duplicate preview',
        target: 'pc',
        taskId: null,
        createdAt: '2026-07-23T00:00:00.000Z',
      }),
    }
    const row = messageStore.append(session.id, { role: 'agent', content: 'Done', toolCalls: [toolCall, toolCall] })
    expect(JSON.parse(row.presentations_json || '[]')).toHaveLength(1)
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

  test('persists a metadata-only multi-file presentation', () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const output = {
      kind: 'files',
      presentationId: 'files-123',
      projectId: 'project-1',
      title: '本次交付',
      files: [
        { path: 'docs/report.md', title: '分析报告', name: 'report.md', extension: '.md', size: 100, kind: 'text', language: 'markdown' },
        { path: 'docs/plan.md', title: '实施方案', name: 'plan.md', extension: '.md', size: 80, kind: 'text', language: 'markdown' },
      ],
      createdAt: '2026-07-23T00:00:00.000Z',
    }
    const row = messageStore.append(session.id, {
      role: 'agent',
      content: 'Done',
      toolCalls: [{ id: 'tool-files', title: 'files.present', status: 'completed', rawOutput: JSON.stringify(output) }],
    })

    expect(JSON.parse(row.presentations_json || '[]')).toEqual([output])
  })

  test('recognizes the dotted Codex MCP title for files.present', () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const output = {
      kind: 'files',
      presentationId: 'files-codex',
      projectId: 'project-1',
      title: 'Codex delivery',
      files: [
        { path: 'report.md', title: 'Report', name: 'report.md', extension: '.md', size: 10, kind: 'text', language: 'markdown' },
      ],
      createdAt: '2026-07-24T00:00:00.000Z',
    }
    const row = messageStore.append(session.id, {
      role: 'agent',
      content: 'Done',
      toolCalls: [{
        id: 'tool-files',
        title: 'mcp.ai-ide-tools.files.present',
        status: 'completed',
        rawOutput: [{ type: 'text', text: JSON.stringify(output) }],
      }],
    })

    expect(JSON.parse(row.presentations_json || '[]')).toEqual([output])
  })

  test('persists the final Codex gateway wrapper using the canonical raw input tool', () => {
    const session = sessionStore.create({ agentId: 'agent-codex' })
    const output = {
      kind: 'files',
      presentationId: 'files-codex-final',
      projectId: 'project-1',
      title: 'Codex final delivery',
      files: [
        { path: 'report.md', title: 'Report', name: 'report.md', extension: '.md', size: 10, kind: 'text', language: 'markdown' },
      ],
      createdAt: '2026-08-03T00:00:00.000Z',
    }
    const row = messageStore.append(session.id, {
      role: 'agent',
      content: 'Done',
      toolCalls: [{
        id: 'tool-files',
        title: 'ai-ide-tools.files.present',
        status: 'completed',
        rawInput: {
          server: 'ai-ide-tools',
          tool: 'files.present',
          arguments: { title: output.title, files: [{ path: 'report.md' }] },
        },
        rawOutput: {
          result: { content: [{ type: 'text', text: JSON.stringify(output) }] },
          error: null,
        },
      }],
    })

    expect(JSON.parse(row.presentations_json || '[]')).toEqual([output])
  })

  test('does not treat a third-party MCP tool as a platform presentation', () => {
    const session = sessionStore.create({ agentId: 'agent-external' })
    const row = messageStore.append(session.id, {
      role: 'agent',
      content: 'Done',
      toolCalls: [{
        id: 'tool-external',
        title: 'external.files.present',
        status: 'completed',
        rawInput: { server: 'external', tool: 'files.present', arguments: {} },
        rawOutput: {
          kind: 'files',
          presentationId: 'files-external',
          projectId: 'project-1',
          title: 'External delivery',
          files: [],
          createdAt: '2026-08-03T00:00:00.000Z',
        },
      }],
    })

    expect(row.presentations_json).toBeNull()
  })

  test('repair migration restores a completed Codex presentation from process detail', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE messages (id TEXT PRIMARY KEY, presentations_json TEXT);
      CREATE TABLE turn_process_items (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT,
        detail_json TEXT
      );
      INSERT INTO messages (id, presentations_json) VALUES ('msg-codex', NULL), ('msg-unrelated', NULL);
    `)
    const output = {
      kind: 'files',
      presentationId: 'files-repaired',
      projectId: 'project-1',
      title: 'Repaired Codex delivery',
      files: [
        { path: 'report.md', title: 'Report', name: 'report.md', extension: '.md', size: 10, kind: 'text', language: 'markdown' },
      ],
      createdAt: '2026-08-03T00:00:00.000Z',
    }
    db.prepare(`
      INSERT INTO turn_process_items (id, message_id, kind, title, detail_json)
      VALUES (?, ?, 'tool', ?, ?), (?, ?, 'tool', ?, ?)
    `).run(
      'tpi-codex', 'msg-codex', 'ai-ide-tools.files.present', JSON.stringify({
        id: 'tool-codex',
        title: 'ai-ide-tools.files.present',
        status: 'completed',
        rawInput: { server: 'ai-ide-tools', tool: 'files.present', arguments: {} },
        rawOutput: { result: { content: [{ type: 'text', text: JSON.stringify(output) }] }, error: null },
      }),
      'tpi-unrelated', 'msg-unrelated', 'Terminal', '{not valid json',
    )

    messagePresentationRepairMigration.up(db)

    const rows = db.prepare<[], { id: string; presentations_json: string | null }>(
      'SELECT id, presentations_json FROM messages ORDER BY id',
    ).all()
    expect(JSON.parse(rows[0].presentations_json || '[]')).toEqual([output])
    expect(rows[1].presentations_json).toBeNull()
    db.close()
  })
})
