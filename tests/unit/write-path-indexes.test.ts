import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-write-path-indexes-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function queryPlan(sql: string, params: Record<string, unknown> = {}): string[] {
  return getDb()
    .prepare('EXPLAIN QUERY PLAN ' + sql)
    .all(params)
    .map((row) => String((row as { detail: string }).detail))
}

describe('写通道 P0 索引(迁移 071)', () => {
  it('initDatabase 返回分阶段耗时并记录本次应用的迁移', () => {
    const timing = initDatabase(resolve(tmp, 'ai-ide.sqlite'))
    expect(timing.reused).toBe(true)
    expect(timing.appliedMigrations).toEqual([])

    closeDatabase()
    const fresh = initDatabase(resolve(tmp, 'fresh-migrations.sqlite'))
    expect(fresh.reused).toBe(false)
    expect(fresh.openMs).toBeGreaterThanOrEqual(0)
    expect(fresh.migrateMs).toBeGreaterThanOrEqual(0)
    expect(fresh.appliedMigrations.map((migration) => migration.version)).toContain('071')
  })

  it('三条索引都已建立', () => {
    const names = getDb()
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?, ?) ORDER BY name`,
      )
      .all('idx_messages_agent_running', 'idx_turn_process_items_open', 'idx_writer_batch_commits_committed_at')
      .map((row) => row.name)
    expect(names).toEqual([
      'idx_messages_agent_running',
      'idx_turn_process_items_open',
      'idx_writer_batch_commits_committed_at',
    ])
  })

  it('启动对账的两条 UPDATE 走部分索引(不再全表扫描)', () => {
    const messagesPlan = queryPlan(
      `UPDATE messages SET status = 'failed' WHERE role = 'agent' AND status = 'running'`,
    ).join('\n')
    expect(messagesPlan).toContain('idx_messages_agent_running')
    expect(messagesPlan).not.toMatch(/^SCAN messages$/m)

    const itemsPlan = queryPlan(
      `UPDATE turn_process_items SET status = 'failed' WHERE status IN ('running','pending','in_progress')`,
    ).join('\n')
    expect(itemsPlan).toContain('idx_turn_process_items_open')
    expect(itemsPlan).not.toMatch(/^SCAN turn_process_items$/m)
  })

  it('writer_batch_commits 按保留窗口清理走 committed_at 索引', () => {
    const plan = queryPlan(
      `DELETE FROM writer_batch_commits WHERE rowid IN (
         SELECT rowid FROM writer_batch_commits WHERE committed_at < @cutoff LIMIT @limit
       )`,
      { cutoff: '2026-01-01T00:00:00.000Z', limit: 1000 },
    ).join('\n')
    expect(plan).toContain('idx_writer_batch_commits_committed_at')
    expect(plan).not.toMatch(/^SCAN writer_batch_commits$/m)
  })

  it('会话 head 查询不再产生临时 B 树排序', () => {
    const plan = queryPlan(
      `SELECT *, MAX(rowid) AS mr FROM writer_batch_commits WHERE session_id = @sessionId`,
      { sessionId: 'sess-none' },
    ).join('\n')
    expect(plan).not.toContain('TEMP B-TREE')
  })
})
