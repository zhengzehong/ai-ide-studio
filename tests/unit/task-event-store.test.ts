import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { taskStore, taskEventStore, extractReportPreview } from '../../src/store/tasks.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-event-store-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

type ReportType = 'milestone' | 'input_requested' | 'marked_done'

function appendReport(taskId: string, type: ReportType, reportMd: string | null, sequence: number, createdAt: string): string {
  const id = `tevt-${taskId}-${sequence}`
  const agentStatus = type === 'input_requested' ? 'blocked' : type === 'milestone' ? 'milestone' : 'done'
  getDb()
    .prepare(
      `INSERT INTO task_events (id, task_id, type, payload_json, sequence, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      taskId,
      type,
      JSON.stringify({ report_md: reportMd, agent_status: agentStatus }),
      sequence,
      createdAt,
    )
  return id
}

function appendEvent(taskId: string, id: string, type: string, payload: Record<string, unknown>, sequence: number, createdAt: string): void {
  getDb()
    .prepare(
      `INSERT INTO task_events (id, task_id, type, payload_json, sequence, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, taskId, type, JSON.stringify(payload), sequence, createdAt)
}

describe('taskEventStore.listLatestByTaskIds', () => {
  test('空数组返回空 map', () => {
    expect(taskEventStore.listLatestByTaskIds([])).toEqual({})
  })

  test('单任务多汇报,取最新(sequence 最大)', () => {
    const task = taskStore.create({ title: 'T1' })
    appendReport(task.id, 'milestone', '第一轮\n## 细节', 1, '2026-06-01T00:00:00.000Z')
    appendReport(task.id, 'milestone', '第二轮', 2, '2026-06-02T00:00:00.000Z')
    appendReport(task.id, 'marked_done', '完成', 3, '2026-06-03T00:00:00.000Z')

    const map = taskEventStore.listLatestByTaskIds([task.id])
    expect(map[task.id].type).toBe('marked_done')
    expect(map[task.id].sequence).toBe(3)
    expect(map[task.id].created_at).toBe('2026-06-03T00:00:00.000Z')
  })

  test('多个任务批量返回,无汇报的任务不在 map 中', () => {
    const t1 = taskStore.create({ title: 'T1' })
    const t2 = taskStore.create({ title: 'T2' })
    const t3 = taskStore.create({ title: 'T3' })
    appendReport(t1.id, 'milestone', 'T1 第一轮', 1, '2026-06-01T00:00:00.000Z')
    appendReport(t2.id, 'input_requested', 'T2 需要确认', 1, '2026-06-02T00:00:00.000Z')

    const map = taskEventStore.listLatestByTaskIds([t1.id, t2.id, t3.id])
    expect(Object.keys(map)).toHaveLength(2)
    expect(map[t1.id].type).toBe('milestone')
    expect(map[t2.id].type).toBe('input_requested')
    expect(map[t3.id]).toBeUndefined()
  })

  test('忽略非汇报事件(status_changed 等)', () => {
    const task = taskStore.create({ title: 'T1' })
    // 状态变更事件 sequence 更高,但不应该被返回
    appendEvent(
      task.id,
      `tevt-${task.id}-status`,
      'status_changed',
      { from_status: 'backlog', to_status: 'executing' },
      10,
      '2026-06-10T00:00:00.000Z',
    )
    appendReport(task.id, 'milestone', 'milestone 1', 5, '2026-06-05T00:00:00.000Z')

    const map = taskEventStore.listLatestByTaskIds([task.id])
    expect(map[task.id].type).toBe('milestone')
    expect(map[task.id].sequence).toBe(5)
  })
})

describe('taskEventStore.getById', () => {
  test('返回单条事件', () => {
    const task = taskStore.create({ title: 'T1' })
    const id = appendReport(task.id, 'milestone', 'hello', 1, '2026-06-01T00:00:00.000Z')

    const row = taskEventStore.getById(id)
    expect(row?.id).toBe(id)
    expect(row?.task_id).toBe(task.id)
    expect(row?.type).toBe('milestone')
  })

  test('不存在返回 null', () => {
    expect(taskEventStore.getById('tevt-not-exist')).toBeNull()
  })
})

describe('extractReportPreview', () => {
  test('取第一行,前 50 字符', () => {
    const json = JSON.stringify({ report_md: '## 本轮工作\n- 完成 X\n- 完成 Y' })
    expect(extractReportPreview(json)).toBe('## 本轮工作')
  })

  test('超长截断到 50 字符', () => {
    const long = 'A'.repeat(100)
    const json = JSON.stringify({ report_md: long })
    expect(extractReportPreview(json)).toBe('A'.repeat(50))
  })

  test('report_md 为 null 返回 null', () => {
    const json = JSON.stringify({ report_md: null })
    expect(extractReportPreview(json)).toBeNull()
  })

  test('第一行为空,返回 null(只取第一行)', () => {
    const json = JSON.stringify({ report_md: '\n## 真正的标题' })
    // 当前实现只取第一行,空行 trim 后为空,返回 null
    expect(extractReportPreview(json)).toBeNull()
  })

  test('全空字符串返回 null', () => {
    const json = JSON.stringify({ report_md: '\n\n' })
    expect(extractReportPreview(json)).toBeNull()
  })

  test('payload 解析失败返回 null', () => {
    expect(extractReportPreview('not-json')).toBeNull()
  })
})
