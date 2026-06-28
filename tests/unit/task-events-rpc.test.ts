import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { taskStore } from '../../src/store/tasks.js'
import { taskRpcHandlers } from '../../src/gateway/rpc/tasks.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-events-rpc-'))
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

async function callTaskRpc(type: string, msg: Record<string, unknown>): Promise<unknown> {
  let result: unknown
  let error: string | null = null
  await taskRpcHandlers[type](
    msg as never,
    {
      state: { subscriptions: new Set() },
      sendResult: (data) => {
        result = data
      },
      sendError: (message) => {
        error = message
      },
      sendOutOfBandError: (message) => {
        error = message
      },
    },
  )
  if (error) throw new Error(error)
  return result
}

describe('tasks.list 含最新报告摘要', () => {
  test('有汇报的 task,三字段填充', async () => {
    const task = taskStore.create({ title: 'T1' })
    appendReport(task.id, 'milestone', '第一轮\n## 细节', 1, '2026-06-01T00:00:00.000Z')
    appendReport(task.id, 'marked_done', '## 完成\n- 全部完成', 2, '2026-06-02T00:00:00.000Z')

    const listed = (await callTaskRpc('tasks.list', { type: 'tasks.list' })) as Array<Record<string, unknown>>
    expect(listed).toHaveLength(1)
    const item = listed[0]
    expect(item.id).toBe(task.id)
    expect(item.latestReportPreview).toBe('## 完成')
    expect(item.latestReportAt).toBe('2026-06-02T00:00:00.000Z')
    expect(item.latestReportType).toBe('marked_done')
  })

  test('无汇报的 task,三字段为 null', async () => {
    const task = taskStore.create({ title: 'T1' })

    const listed = (await callTaskRpc('tasks.list', { type: 'tasks.list' })) as Array<Record<string, unknown>>
    const item = listed.find(t => t.id === task.id)
    expect(item?.latestReportPreview).toBeNull()
    expect(item?.latestReportAt).toBeNull()
    expect(item?.latestReportType).toBeNull()
  })

  test('reportMd 为 null 的汇报,preview 为 null,type/at 仍填充', async () => {
    const task = taskStore.create({ title: 'T1' })
    appendReport(task.id, 'input_requested', null, 1, '2026-06-03T00:00:00.000Z')

    const listed = (await callTaskRpc('tasks.list', { type: 'tasks.list' })) as Array<Record<string, unknown>>
    const item = listed.find(t => t.id === task.id)
    expect(item?.latestReportPreview).toBeNull()
    expect(item?.latestReportAt).toBe('2026-06-03T00:00:00.000Z')
    expect(item?.latestReportType).toBe('input_requested')
  })

  test('长摘要截断到 50 字符', async () => {
    const task = taskStore.create({ title: 'T1' })
    appendReport(task.id, 'milestone', 'A'.repeat(100), 1, '2026-06-01T00:00:00.000Z')

    const listed = (await callTaskRpc('tasks.list', { type: 'tasks.list' })) as Array<Record<string, unknown>>
    const item = listed.find(t => t.id === task.id)
    expect(item?.latestReportPreview).toBe('A'.repeat(50))
  })

  test('多个任务批量返回,不互相串扰', async () => {
    const t1 = taskStore.create({ title: 'T1' })
    const t2 = taskStore.create({ title: 'T2' })
    const t3 = taskStore.create({ title: 'T3' })
    appendReport(t1.id, 'milestone', 'T1 报告', 1, '2026-06-01T00:00:00.000Z')
    appendReport(t2.id, 'input_requested', 'T2 报告', 1, '2026-06-02T00:00:00.000Z')
    // t3 无报告

    const listed = (await callTaskRpc('tasks.list', { type: 'tasks.list' })) as Array<Record<string, unknown>>
    const items: Record<string, Record<string, unknown>> = {}
    for (const item of listed) items[item.id as string] = item

    expect(items[t1.id].latestReportPreview).toBe('T1 报告')
    expect(items[t1.id].latestReportType).toBe('milestone')
    expect(items[t2.id].latestReportPreview).toBe('T2 报告')
    expect(items[t2.id].latestReportType).toBe('input_requested')
    expect(items[t3.id].latestReportPreview).toBeNull()
    expect(items[t3.id].latestReportType).toBeNull()
  })
})

describe('tasks.events.get', () => {
  test('返回单条事件,含解析后的 reportMd 和 agentStatus', async () => {
    const task = taskStore.create({ title: 'T1' })
    const id = appendReport(task.id, 'milestone', '## 本轮工作\n- 完成 X', 1, '2026-06-01T00:00:00.000Z')

    const result = (await callTaskRpc('tasks.events.get', {
      type: 'tasks.events.get',
      taskId: task.id,
      eventId: id,
    })) as Record<string, unknown>

    expect(result.id).toBe(id)
    expect(result.taskId).toBe(task.id)
    expect(result.type).toBe('milestone')
    expect(result.sequence).toBe(1)
    expect(result.createdAt).toBe('2026-06-01T00:00:00.000Z')
    expect(result.reportMd).toBe('## 本轮工作\n- 完成 X')
    expect(result.agentStatus).toBe('milestone')
  })

  test('report_md 为 null 时,reportMd 为 null', async () => {
    const task = taskStore.create({ title: 'T1' })
    const id = appendReport(task.id, 'marked_done', null, 1, '2026-06-01T00:00:00.000Z')

    const result = (await callTaskRpc('tasks.events.get', {
      type: 'tasks.events.get',
      taskId: task.id,
      eventId: id,
    })) as Record<string, unknown>

    expect(result.reportMd).toBeNull()
    expect(result.agentStatus).toBe('done')
  })

  test('eventId 不存在 → 返回错误"事件不存在"', async () => {
    const task = taskStore.create({ title: 'T1' })
    await expect(callTaskRpc('tasks.events.get', {
      type: 'tasks.events.get',
      taskId: task.id,
      eventId: 'tevt-not-exist',
    })).rejects.toThrow('事件不存在')
  })

  test('eventId 属于其他 task → 返回错误(防越权)', async () => {
    const t1 = taskStore.create({ title: 'T1' })
    const t2 = taskStore.create({ title: 'T2' })
    const id = appendReport(t1.id, 'milestone', 'T1 报告', 1, '2026-06-01T00:00:00.000Z')

    // 用 t2 的 taskId 查 t1 的事件 id,应该被拒绝
    await expect(callTaskRpc('tasks.events.get', {
      type: 'tasks.events.get',
      taskId: t2.id,
      eventId: id,
    })).rejects.toThrow('事件不存在')
  })

  test('taskId 缺失 → 返回错误', async () => {
    await expect(callTaskRpc('tasks.events.get', {
      type: 'tasks.events.get',
      eventId: 'tevt-anything',
    })).rejects.toThrow('taskId')
  })

  test('eventId 缺失 → 返回错误', async () => {
    const task = taskStore.create({ title: 'T1' })
    await expect(callTaskRpc('tasks.events.get', {
      type: 'tasks.events.get',
      taskId: task.id,
    })).rejects.toThrow('eventId')
  })
})

describe('tasks.events.list 不受影响', () => {
  test('仍返回全部事件列表', async () => {
    const task = taskStore.create({ title: 'T1' })
    appendReport(task.id, 'milestone', 'R1', 1, '2026-06-01T00:00:00.000Z')
    appendReport(task.id, 'marked_done', 'R2', 2, '2026-06-02T00:00:00.000Z')

    const result = (await callTaskRpc('tasks.events.list', {
      type: 'tasks.events.list',
      taskId: task.id,
    })) as Array<Record<string, unknown>>

    expect(result).toHaveLength(3) // create + milestone + marked_done
    expect(result.map(r => r.type)).toContain('milestone')
    expect(result.map(r => r.type)).toContain('marked_done')
  })
})
