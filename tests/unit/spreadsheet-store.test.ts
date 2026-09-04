import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import {
  DEFAULT_NEW_TABLE_FIELDS,
  parseSchema,
  spreadsheetRecordStore,
  spreadsheetStore,
  validateRowData,
  type SpreadsheetSchema,
} from '../../src/store/spreadsheets.js'
import { projectStore } from '../../src/store/projects.js'
import { dispatchRpc } from '../../src/gateway/rpc/registry.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-spreadsheet-store-'))
let index = 0

beforeEach(() => {
  closeDatabase()
  const dir = resolve(root, `case-${++index}`)
  mkdirSync(dir, { recursive: true })
  initDatabase(resolve(dir, 'test.sqlite'))
})

afterEach(() => closeDatabase())
afterAll(() => rmSync(root, { recursive: true, force: true }))

function makeRpcContext(authMode: 'owner' | 'guest'): { context: RpcContext; results: unknown[]; errors: string[] } {
  const results: unknown[] = []
  const errors: string[] = []
  return {
    context: {
      state: { subscriptions: new Set(), authMode },
      sendResult: (data) => results.push(data),
      sendError: (message) => errors.push(message),
      sendOutOfBandError: (message) => errors.push(message),
    },
    results,
    errors,
  }
}

async function rpc(type: string, payload: Record<string, unknown>, authMode: 'owner' | 'guest' = 'owner'): Promise<{
  results: unknown[]
  errors: string[]
}> {
  const { context, results, errors } = makeRpcContext(authMode)
  try {
    // 与 ws-handler.ts 同语义：handler throw 的错误被捕获后转 sendError
    await dispatchRpc({ type, ...payload }, context)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : '未知错误')
  }
  return { results, errors }
}

const CUSTOM_SCHEMA: SpreadsheetSchema = {
  fields: [
    { key: 'title', name: '标题', type: 'text', w: 200 },
    { key: 'level', name: '层次', type: 'singleSelect', w: 120, options: [{ n: 'P0', c: 'red' }, { n: 'P1', c: 'blue' }] },
    { key: 'due', name: '截止', type: 'date', w: 110 },
    { key: 'hours', name: '工时', type: 'number', w: 90 },
    { key: 'done', name: '完成', type: 'checkbox', w: 80 },
  ],
}

describe('spreadsheet store', () => {
  test('creates a table with default 3 fields and enforces unique name per project', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const sheet = spreadsheetStore.create({ projectId: project.id, title: 'bug 清单' })
    expect(sheet.title).toBe('bug 清单')
    expect(sheet.name).toMatch(/^tbl-/)
    const schema = parseSchema(sheet)
    expect(schema.fields.map((field) => field.key)).toEqual(['title', 'status', 'due'])
    expect(DEFAULT_NEW_TABLE_FIELDS).toHaveLength(3)

    expect(() => spreadsheetStore.create({ projectId: project.id, title: '重名', name: sheet.name })).toThrow('已存在')

    // 同名表在不同项目下允许（UNIQUE(project_id, name)）
    const other = projectStore.create({ name: 'Q', workDir: root })
    expect(() => spreadsheetStore.create({ projectId: other.id, title: '跨项目同名', name: sheet.name })).not.toThrow()
  })

  test('record CRUD, reorder sort, and cascade delete', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const sheet = spreadsheetStore.create({ projectId: project.id, title: 'T', schema: CUSTOM_SCHEMA })

    const first = spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: '第一行', level: 'P0', hours: 2, done: false }, createdBy: 'user' })
    const second = spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: '第二行' }, createdBy: 'agent:agent-1' })
    expect(second.sort).toBeGreaterThan(first.sort)
    expect(second.created_by).toBe('agent:agent-1')

    // 行拖拽重排：second 提到第一位后 sort 顺序反转
    spreadsheetRecordStore.reorder(sheet.id, [second.id, first.id])
    const reordered = spreadsheetRecordStore.list(sheet.id)
    expect(reordered.map((row) => row.id)).toEqual([second.id, first.id])
    expect(reordered[0].sort).toBeLessThan(reordered[1].sort)

    // 内联编辑保存
    spreadsheetRecordStore.updateData(first.id, { title: '第一行改', level: 'P1', due: '2026-09-08', hours: 3.5, done: true })
    expect(parseRecordDataForTest(first.id)).toMatchObject({ title: '第一行改', level: 'P1', due: '2026-09-08', hours: 3.5, done: true })

    // 级联删：删表后记录一并消失
    expect(spreadsheetStore.remove(sheet.id)).toBe(true)
    expect(spreadsheetRecordStore.list(sheet.id)).toHaveLength(0)
    expect(spreadsheetStore.get(sheet.id)).toBeUndefined()
  })

  test('validateRowData enforces schema types and returns legal options for singleSelect', () => {
    const schema = CUSTOM_SCHEMA
    expect(validateRowData(schema, { title: 'ok', level: 'P0', due: '2026-09-08', hours: 1, done: true })).toEqual([])

    const issues = validateRowData(schema, {
      title: 'x',
      level: '不存在的选项',
      due: '2026/09/08',
      hours: '三',
      done: 'yes',
    })
    expect(issues.map((issue) => issue.fieldKey)).toEqual(['level', 'due', 'hours', 'done'])
    expect(issues[0].message).toContain('P0、P1')

    // 空值视为未填，任何类型都合法
    expect(validateRowData(schema, { level: '', due: null, hours: undefined })).toEqual([])
  })
})

function parseRecordDataForTest(recordId: string): Record<string, unknown> {
  const record = spreadsheetRecordStore.get(recordId)
  if (!record) throw new Error('record missing')
  return JSON.parse(record.data_json) as Record<string, unknown>
}

describe('spreadsheet RPC auth and validation', () => {
  test('guest is rejected for every spreadsheet rpc while owner passes', async () => {
    const project = projectStore.create({ name: 'P', workDir: root })

    const denied = await rpc('spreadsheets.list', { projectId: project.id }, 'guest')
    expect(denied.results).toHaveLength(0)
    expect(denied.errors[0]).toContain('访客无权访问表格')

    const allowed = await rpc('spreadsheets.create', { projectId: project.id, title: 'RPC 建表' }, 'owner')
    expect(allowed.errors).toHaveLength(0)
    const sheet = (allowed.results[0] as { spreadsheet: { id: string; name: string } }).spreadsheet
    expect(sheet.name).toMatch(/^tbl-/)

    const guestDeniedAgain = await rpc('spreadsheet.records.list', { spreadsheetId: sheet.id }, 'guest')
    expect(guestDeniedAgain.errors[0]).toContain('访客无权访问表格')
  })

  test('cross-project sheet access is rejected as unauthorized', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: root })
    const projectB = projectStore.create({ name: 'B', workDir: root })
    const sheetB = spreadsheetStore.create({ projectId: projectB.id, title: 'B 的表' })

    // 项目 A 的上下文里操作 B 的表：拒绝（越权）
    const cross = await rpc('spreadsheets.patch', { spreadsheetId: sheetB.id, projectId: projectA.id, title: '改名' })
    void projectA
    expect(cross.results).toHaveLength(0)
    expect(cross.errors[0]).toContain('403')

    // records handler 同样校验归属：声明 projectA 访问 B 的表 → 403
    const listA = await rpc('spreadsheet.records.list', { spreadsheetId: sheetB.id, projectId: projectA.id })
    expect(listA.results).toHaveLength(0)
    expect(listA.errors[0]).toContain('403')

    // 不传 projectId 时不做归属校验（owner 全局视角），正常返回
    const listAll = await rpc('spreadsheet.records.list', { spreadsheetId: sheetB.id })
    expect(listAll.errors).toHaveLength(0)
    expect(listAll.results[0]).toEqual({ records: [] })
  })

  test('records.create validates data and returns the error message with legal options', async () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const sheet = spreadsheetStore.create({ projectId: project.id, title: 'T', schema: CUSTOM_SCHEMA })

    const bad = await rpc('spreadsheet.records.create', {
      spreadsheetId: sheet.id,
      data: { title: 'x', level: '非法', due: 'bad-date', hours: 'abc', done: 'nope' },
    })
    expect(bad.results).toHaveLength(0)
    const message = bad.errors.join('；')
    expect(message).toContain('P0、P1')
    expect(message).toContain('YYYY-MM-DD')
    expect(message).toContain('数字')
    expect(message).toContain('true/false')

    const good = await rpc('spreadsheet.records.create', {
      spreadsheetId: sheet.id,
      data: { title: '合法行', level: 'P0' },
    })
    expect(good.errors).toHaveLength(0)
    const record = (good.results[0] as { record: { id: string; created_by: string } }).record
    expect(record.created_by).toBe('user')
  })

  test('records.reorder rewrites sort in the given order', async () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const sheet = spreadsheetStore.create({ projectId: project.id, title: 'T', schema: CUSTOM_SCHEMA })
    const a = spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: 'A' }, createdBy: 'user' })
    const b = spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: 'B' }, createdBy: 'user' })
    const c = spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: 'C' }, createdBy: 'user' })

    const { results, errors } = await rpc('spreadsheet.records.reorder', {
      spreadsheetId: sheet.id,
      recordIds: [c.id, a.id, b.id],
    })
    expect(errors).toHaveLength(0)
    const records = (results[0] as { records: { id: string; sort: number }[] }).records
    expect(records.map((row) => row.id)).toEqual([c.id, a.id, b.id])
    expect(records.map((row) => row.sort)).toEqual([0, 1, 2])
  })

  test('delete cascade via rpc removes records', async () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const sheet = spreadsheetStore.create({ projectId: project.id, title: 'T', schema: CUSTOM_SCHEMA })
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: 'x' }, createdBy: 'user' })

    const { results } = await rpc('spreadsheets.delete', { spreadsheetId: sheet.id })
    expect((results[0] as { deleted: boolean }).deleted).toBe(true)
    expect(spreadsheetRecordStore.list(sheet.id)).toHaveLength(0)

    const direct = getDb().prepare('SELECT COUNT(*) AS count FROM spreadsheet_records WHERE spreadsheet_id = ?').get(sheet.id) as { count: number }
    expect(direct.count).toBe(0)
  })
})
