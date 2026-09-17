import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { turnProcessItemStore } from '../../src/store/turn-process-items.js'
import { migrations } from '../../src/store/migrations/index.js'
import { messagesFileChangesSlimMigration } from '../../src/store/migrations/076-messages-file-changes-slim.js'
import { finalizeSessionTurn } from '../../src/data-worker/writer-worker/turn-process-operations.js'

/**
 * 瘦身(P1)两件事:
 * 1. 写入侧不再把 detail 的 segments(diff 正文)整包写进 messages.file_changes_json;
 * 2. 迁移 076 清理历史死数据,且只碰确有 segments 的行。
 */
let tmp: string
let dbPath: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-slim-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('messages file changes slimming (076)', () => {
  it('strips only the dead segments field and leaves the summary fields intact', () => {
    const db = getDb()
    const segmented = JSON.stringify({
      files: [{
        path: 'D:/project/a.ts',
        changeType: 'M',
        addedLines: 3,
        deletedLines: 1,
        segments: [{ toolCallId: 't1', newText: 'x'.repeat(2048), addedLines: 3, deletedLines: 1 }],
      }],
      totalAdded: 3,
      totalDeleted: 1,
    })
    const clean = JSON.stringify({ files: [{ path: 'D:/project/b.ts', changeType: 'A', addedLines: 1, deletedLines: 0 }], totalAdded: 1, totalDeleted: 0 })
    db.prepare("INSERT INTO messages (id, session_id, role, content, file_changes_json, timestamp, status) VALUES ('m-seg', 's1', 'agent', 'x', ?, '2026-09-17T00:00:00.000Z', 'completed')").run(segmented)
    db.prepare("INSERT INTO messages (id, session_id, role, content, file_changes_json, timestamp, status) VALUES ('m-clean', 's1', 'agent', 'x', ?, '2026-09-17T00:00:00.000Z', 'completed')").run(clean)
    db.prepare("INSERT INTO messages (id, session_id, role, content, file_changes_json, timestamp, status) VALUES ('m-broken', 's1', 'agent', 'x', '{不是 JSON', '2026-09-17T00:00:00.000Z', 'completed')").run()

    messagesFileChangesSlimMigration.up(db)

    const read = (id: string) => (db.prepare('SELECT file_changes_json AS json FROM messages WHERE id = ?').get(id) as { json: string | null }).json
    const slimmed = JSON.parse(read('m-seg')!) as { files: Record<string, unknown>[]; totalAdded: number; totalDeleted: number }
    expect(slimmed.totalAdded).toBe(3)
    expect(slimmed.totalDeleted).toBe(1)
    expect(slimmed.files[0]).toEqual({ path: 'D:/project/a.ts', changeType: 'M', addedLines: 3, deletedLines: 1 })
    expect(read('m-clean')).toBe(clean)
    expect(read('m-broken')).toBe('{不是 JSON')
    // 体积证据:segments 是唯一被丢掉的字段
    expect(read('m-seg')!.length).toBeLessThan(segmented.length / 10)
  })

  it('is registered as migration 076 at the end of the chain', () => {
    expect(migrations.at(-1)).toMatchObject({ version: '076', name: 'messages_file_changes_slim' })
  })
})

describe('writer no longer persists diff segments', () => {
  it('keeps only the summary fields when finalizing a turn', () => {
    const project = projectStore.create({ name: 'Slim Project', workDir: 'D:/slim' })
    const agent = agentStore.create({ name: 'Slim Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const message = messageStore.append(session.id, { role: 'agent', content: 'running', status: 'running' })
    // detail 带 segments(与生产 detail_json 同形)
    turnProcessItemStore.upsert({
      messageId: message.id,
      sessionId: session.id,
      kind: 'file_change',
      title: '编辑文件',
      detail: {
        files: [{
          path: 'D:/project/a.ts',
          changeType: 'M',
          addedLines: 2,
          deletedLines: 1,
          segments: [{ toolCallId: 't1', newText: 'y'.repeat(1024), addedLines: 2, deletedLines: 1 }],
        }],
        totalAdded: 2,
        totalDeleted: 1,
      },
    })
    finalizeSessionTurn(getDb(), { messageId: message.id, sessionId: session.id, processStatus: 'completed', content: 'done', status: 'completed', timestamp: '2026-09-17T00:00:00.000Z' })

    const stored = (getDb().prepare('SELECT file_changes_json AS json FROM messages WHERE id = ?').get(message.id) as { json: string | null }).json
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored!) as { files: Record<string, unknown>[] }
    expect(parsed.files[0]).toEqual({ path: 'D:/project/a.ts', changeType: 'M', addedLines: 2, deletedLines: 1 })
    expect(JSON.stringify(parsed)).not.toContain('segments')
    // 界面上"改了 X 个文件"徽标的数据源不变
    expect(parsed.files).toHaveLength(1)
  })
})
