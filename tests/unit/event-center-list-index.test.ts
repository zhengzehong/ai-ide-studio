import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import {
  DEFAULT_EVENT_LIST_LIMIT,
  eventCenterEventStore,
  MAX_EVENT_LIST_LIMIT,
} from '../../src/store/event-center-events.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-event-list-index-'))
const projectId = 'proj-event-list'

beforeAll(() => {
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  const insert = getDb().prepare(`
    INSERT INTO event_center_events (
      id, project_id, category_id, title, summary, source_type, source_id, source_label,
      priority, confidence, status, tags_json, payload_json, evidence_json, dedupe_key,
      created_by_agent_id, created_at, updated_at, archived_at
    ) VALUES (
      @id, @project_id, 'task.lifecycle', @title, NULL, 'task', NULL, NULL,
      'medium', 1, 'pending', '[]', '{"step":"1"}', '[{"title":"证据"}]', NULL,
      NULL, @created_at, @created_at, NULL
    )
  `)
  const write = getDb().transaction((rows: Array<{ id: string; title: string; created_at: string }>) => {
    for (const row of rows) insert.run({ ...row, project_id: projectId })
  })
  write(
    Array.from({ length: 260 }, (_, index) => ({
      id: `evt-${String(index).padStart(4, '0')}`,
      title: `事件 ${index}`,
      // created_at 递增 → 倒序查询应拿到序号最大的
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  )
})

afterAll(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('事件中心列表索引与投影(迁移 074 / P0-2)', () => {
  it('迁移 074 建立了 (project_id, created_at) 索引', () => {
    const index = getDb()
      .prepare<[], { name: string; sql: string }>(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_event_center_events_project_created'",
      )
      .get()
    expect(index?.name).toBe('idx_event_center_events_project_created')
    expect(index?.sql).toContain('project_id')
    expect(index?.sql).toContain('created_at DESC')
  })

  it('listPage 的排序不再需要全候选临时 B 树排序', () => {
    const plan = getDb()
      .prepare<[string], { detail: string }>(`
        EXPLAIN QUERY PLAN
        SELECT id, project_id, created_at FROM event_center_events
        WHERE project_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 30 OFFSET 0
      `)
      .all(projectId)
      .map((row) => row.detail)
      .join('\n')
    expect(plan).toContain('idx_event_center_events_project_created')
    // 允许 LAST TERM 的 tie-break 排序(created_at 相同的 <=2 行),
    // 但绝不能是 `FOR ORDER BY`(那意味着读完全部候选再排序)。
    expect(plan).not.toMatch(/TEMP B-TREE FOR ORDER BY\b(?! OF LAST TERM)/)
  })

  it('列表投影不含 evidence_json,但保留 payload_json', () => {
    const page = eventCenterEventStore.listPage({ projectId, limit: 5 })
    expect(page.items).toHaveLength(5)
    expect(page.items[0]).not.toHaveProperty('evidence_json')
    // payload_json 是事件中心 chips 与详情面板的数据来源,必须保留
    expect(page.items[0]).toHaveProperty('payload_json')
    expect(page.items[0]).toHaveProperty('title')
    expect(page.total).toBe(260)
  })

  it('list() 默认上限 200,显式 limit 可超过但有硬上限', () => {
    const byDefault = eventCenterEventStore.list({ projectId })
    expect(byDefault).toHaveLength(DEFAULT_EVENT_LIST_LIMIT)
    // 倒序:第一行应是最新的(序号最大的)事件
    expect(byDefault[0]?.title).toBe('事件 259')

    expect(eventCenterEventStore.list({ projectId, limit: 250 })).toHaveLength(250)
    expect(eventCenterEventStore.list({ projectId, limit: 99999 })).toHaveLength(
      Math.min(260, MAX_EVENT_LIST_LIMIT),
    )
    // 非法 limit 回落默认值
    expect(eventCenterEventStore.list({ projectId, limit: Number.NaN })).toHaveLength(DEFAULT_EVENT_LIST_LIMIT)
    expect(eventCenterEventStore.list({ projectId, limit: 0 })).toHaveLength(1)
  })

  it('分页结果与改造前的语义一致(倒序 + 翻页不重不漏)', () => {
    const first = eventCenterEventStore.listPage({ projectId, limit: 30, offset: 0 })
    const second = eventCenterEventStore.listPage({ projectId, limit: 30, offset: 30 })
    expect(first.items[0]?.title).toBe('事件 259')
    expect(first.items[29]?.title).toBe('事件 230')
    expect(second.items[0]?.title).toBe('事件 229')
    const ids = new Set([...first.items, ...second.items].map((row) => row.id))
    expect(ids.size).toBe(60)
  })

  it('get() 仍返回完整行(含 evidence_json)', () => {
    const full = eventCenterEventStore.get('evt-0001')
    expect(full?.evidence_json).toBe('[{"title":"证据"}]')
  })
})
