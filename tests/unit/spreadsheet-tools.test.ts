import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { parseRecordData, parseSchema, spreadsheetRecordStore, spreadsheetStore, type SpreadsheetSchema } from '../../src/store/spreadsheets.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-spreadsheet-tools-'))
let index = 0

beforeEach(() => {
  closeDatabase()
  const dir = resolve(root, `case-${++index}`)
  mkdirSync(dir, { recursive: true })
  initDatabase(resolve(dir, 'test.sqlite'))
  seedBuiltinTools()
})

afterEach(() => closeDatabase())
afterAll(() => rmSync(root, { recursive: true, force: true }))

const SCHEMA: SpreadsheetSchema = {
  fields: [
    { key: 'title', name: '标题', type: 'text', w: 200 },
    { key: 'level', name: '层次', type: 'singleSelect', w: 120, options: [{ n: 'P0', c: 'red' }, { n: 'P1', c: 'blue' }] },
    { key: 'due', name: '截止', type: 'date', w: 110 },
    { key: 'score', name: '分数', type: 'number', w: 90 },
    { key: 'done', name: '完成', type: 'checkbox', w: 80 },
  ],
}

function makeContext(projectId?: string, agentId = 'agent-1'): ToolContext {
  return { projectId, agentId, sessionId: 'sess-1', workDir: root }
}

async function exec(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<{ result: ToolHandlerResult; json: Record<string, unknown> }> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  const result = await handler.execute(input, context)
  return { result, json: JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown> }
}

/** 期望成功：isError 必须为假 */
async function ok(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { result, json } = await exec(handlerName, input, context)
  expect(result.isError).not.toBe(true)
  return json
}

/** 期望失败：返回错误 JSON（confirm 协议等 isError 响应） */
async function fail(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { result, json } = await exec(handlerName, input, context)
  expect(result.isError).toBe(true)
  return json
}

function setupSheet(): { project: ReturnType<typeof projectStore.create>; sheet: ReturnType<typeof spreadsheetStore.create> } {
  const project = projectStore.create({ name: 'P', workDir: root })
  const sheet = spreadsheetStore.create({ projectId: project.id, title: 'bug 清单', name: 'bug-list', schema: SCHEMA })
  return { project, sheet }
}

describe('spreadsheet_list_tables', () => {
  test('lists tables with schema and record count for the session project', async () => {
    const { project, sheet } = setupSheet()
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: 'a' }, createdBy: 'user' })

    const json = await ok('spreadsheet_list_tables', {}, makeContext(project.id))
    const tables = json.tables as Array<{ name: string; title: string; fields: unknown[]; recordCount: number }>
    expect(tables).toHaveLength(1)
    expect(tables[0]).toMatchObject({ name: 'bug-list', title: 'bug 清单', recordCount: 1 })
    expect(tables[0].fields).toHaveLength(5)
  })

  test('rejects when the session has no project bound', async () => {
    setupSheet()
    const json = await fail('spreadsheet_list_tables', {}, makeContext(undefined))
    expect(json.error).toContain('未绑定项目')
  })

  test('only shows tables of the session project (no cross-project leak)', async () => {
    const { project } = setupSheet()
    const other = projectStore.create({ name: 'Q', workDir: root })
    spreadsheetStore.create({ projectId: other.id, title: '别的项目表', name: 'other-list', schema: SCHEMA })

    const json = await ok('spreadsheet_list_tables', {}, makeContext(project.id))
    const tables = json.tables as Array<{ name: string }>
    expect(tables.map((table) => table.name)).toEqual(['bug-list'])
  })
})

describe('spreadsheet_query_rows', () => {
  test('filter AND combination, projection, limit and offset', async () => {
    const { project, sheet } = setupSheet()
    const ctx = makeContext(project.id)
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: '登录崩溃', level: 'P0', due: '2026-09-01', score: 3, done: false }, createdBy: 'user' })
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: '支付超时', level: 'P1', due: '2026-09-02', score: 5, done: false }, createdBy: 'user' })
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: '导出乱码', level: 'P1', due: '2026-09-03', score: 2, done: true }, createdBy: 'user' })

    // filter：AND 组合（text 包含匹配 + singleSelect 相等匹配）
    const filtered = await ok('spreadsheet_query_rows', { table: 'bug-list', filter: { title: '支付', level: 'P1' } }, ctx)
    expect(filtered.total).toBe(1)
    expect((filtered.records as Array<Record<string, unknown>>)[0].data).toMatchObject({ title: '支付超时' })

    // fields 投影：只返回指定字段，缺失字段补 null
    const projected = await ok('spreadsheet_query_rows', { table: 'bug-list', filter: { title: '支付' }, fields: ['title', 'done'] }, ctx)
    expect((projected.records as Array<Record<string, unknown>>)[0].data).toEqual({ title: '支付超时', done: false })

    // limit + offset 分页
    const page1 = await ok('spreadsheet_query_rows', { table: 'bug-list', limit: 2, offset: 0 }, ctx)
    const page2 = await ok('spreadsheet_query_rows', { table: 'bug-list', limit: 2, offset: 2 }, ctx)
    expect((page1.records as unknown[]).length).toBe(2)
    expect((page2.records as unknown[]).length).toBe(1)

    // limit 上限 200：请求 500 也最多 200（total 只有 3 行即可验证不越界）
    const capped = await ok('spreadsheet_query_rows', { table: 'bug-list', limit: 500 }, ctx)
    expect((capped.records as unknown[]).length).toBe(3)
  })

  test('unknown filter/projection field errors with available field list', async () => {
    const { project } = setupSheet()
    const ctx = makeContext(project.id)

    const badFilter = await fail('spreadsheet_query_rows', { table: 'bug-list', filter: { typo: 'x' } }, ctx)
    expect(badFilter.error).toContain('过滤字段不存在')
    expect(badFilter.error).toContain('title')

    const badProjection = await fail('spreadsheet_query_rows', { table: 'bug-list', fields: ['typo'] }, ctx)
    expect(badProjection.error).toContain('投影字段不存在')
  })

  test('missing table errors with a helpful message', async () => {
    const { project } = setupSheet()
    const json = await fail('spreadsheet_query_rows', { table: 'nope' }, makeContext(project.id))
    expect(json.error).toContain('表格不存在')
    expect(json.error).toContain('spreadsheet_list_tables')
  })
})

describe('spreadsheet_write_rows', () => {
  test('append validates schema; error message contains legal options for self-correction', async () => {
    const { project, sheet } = setupSheet()
    const ctx = makeContext(project.id, 'agent-9')

    const bad = await fail('spreadsheet_write_rows', {
      table: 'bug-list',
      mode: 'append',
      rows: [{ title: '新 bug', level: '紧急', due: '09/01', score: '很多', done: 'yes' }],
    }, ctx)
    expect(bad.error).toContain('rows[0] 校验失败')
    expect(bad.error).toContain('P0、P1') // 合法选项列表
    expect(bad.error).toContain('YYYY-MM-DD')
    expect(bad.error).toContain('数字')
    expect(bad.error).toContain('true/false')

    const good = await ok('spreadsheet_write_rows', {
      table: 'bug-list',
      mode: 'append',
      rows: [{ title: '新 bug', level: 'P0' }],
    }, ctx)
    expect(good.created).toBe(1)
    const records = (good.records as Array<Record<string, unknown>>)
    expect(records[0].createdBy).toBe('agent:agent-9') // created_by 记录 agent 来源

    const stored = spreadsheetRecordStore.list(sheet.id)
    expect(stored).toHaveLength(1)
    expect(parseRecordData(stored[0])).toMatchObject({ title: '新 bug', level: 'P0' })
    expect(stored[0].created_by).toBe('agent:agent-9')
  })

  test('update merges partial data and validates the merged row', async () => {
    const { project, sheet } = setupSheet()
    const ctx = makeContext(project.id)
    const record = spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: '登录崩溃', level: 'P0', score: 3 }, createdBy: 'user' })

    const json = await ok('spreadsheet_write_rows', {
      table: 'bug-list',
      mode: 'update',
      rows: [{ recordId: record.id, level: 'P1', done: true }],
    }, ctx)
    expect(json.updated).toBe(1)

    const after = spreadsheetRecordStore.get(record.id)
    expect(after && parseRecordData(after)).toMatchObject({ title: '登录崩溃', level: 'P1', score: 3, done: true })

    // 合并后校验失败：整行拒绝
    const bad = await fail('spreadsheet_write_rows', {
      table: 'bug-list',
      mode: 'update',
      rows: [{ recordId: record.id, level: '不存在' }],
    }, ctx)
    expect(bad.error).toContain('P0、P1')
  })

  test('update rejects records from another table and requires recordId', async () => {
    const { project, sheet } = setupSheet()
    const ctx = makeContext(project.id)
    const otherSheet = spreadsheetStore.create({ projectId: project.id, title: '另一张表', name: 'other-list', schema: SCHEMA })
    const foreign = spreadsheetRecordStore.create({ spreadsheetId: otherSheet.id, data: { title: '别人的行' }, createdBy: 'user' })

    const cross = await fail('spreadsheet_write_rows', {
      table: 'bug-list',
      mode: 'update',
      rows: [{ recordId: foreign.id, done: true }],
    }, ctx)
    expect(cross.error).toContain('不存在或不属于该表')

    const noId = await fail('spreadsheet_write_rows', { table: 'bug-list', mode: 'update', rows: [{ done: true }] }, ctx)
    expect(noId.error).toContain('recordId')

    void sheet
  })

  test('rejects invalid mode and empty rows', async () => {
    const { project } = setupSheet()
    const ctx = makeContext(project.id)
    const badMode = await fail('spreadsheet_write_rows', { table: 'bug-list', mode: 'delete', rows: [{ title: 'x' }] }, ctx)
    expect(badMode.error).toContain('mode')
    const emptyRows = await fail('spreadsheet_write_rows', { table: 'bug-list', mode: 'append', rows: [] }, ctx)
    expect(emptyRows.error).toContain('rows')
  })
})

describe('spreadsheet_manage_schema', () => {
  test('addField appends field; addOption auto-colors and rejects duplicates', async () => {
    const { project, sheet } = setupSheet()
    const ctx = makeContext(project.id)

    const added = await ok('spreadsheet_manage_schema', { table: 'bug-list', action: 'addField', field: { name: '负责人', type: 'text' } }, ctx)
    const fields = added.fields as Array<{ key: string; name: string; type: string }>
    expect(fields).toHaveLength(6)
    expect(fields[5]).toMatchObject({ name: '负责人', type: 'text' })

    // 新字段的 key 也直接可写（中文默认生成 key）
    const addedKey = (added.addedField as { key: string }).key
    await ok('spreadsheet_write_rows', { table: 'bug-list', mode: 'append', rows: [{ title: 'x', [addedKey]: '张三' }] }, ctx)
    const row = spreadsheetRecordStore.list(sheet.id).at(-1)
    expect(row && parseRecordData(row)[addedKey]).toBe('张三')

    // singleSelect 字段带初始选项
    const withOptions = await ok('spreadsheet_manage_schema', {
      table: 'bug-list',
      action: 'addField',
      field: { name: '优先级', type: 'singleSelect', options: ['高', '中', '低'] },
    }, ctx)
    const prio = withOptions.addedField as { options: Array<{ n: string; c: string }> }
    expect(prio.options.map((option) => option.n)).toEqual(['高', '中', '低'])
    expect(prio.options.every((option) => typeof option.c === 'string' && option.c.length > 0)).toBe(true)

    // addOption：自动配色 + 重复拒绝
    const option = await ok('spreadsheet_manage_schema', { table: 'bug-list', action: 'addOption', fieldKey: 'level', option: { name: 'P2' } }, ctx)
    expect((option.options as Array<{ n: string }>).map((item) => item.n)).toEqual(['P0', 'P1', 'P2'])
    const dup = await fail('spreadsheet_manage_schema', { table: 'bug-list', action: 'addOption', fieldKey: 'level', option: { name: 'P2' } }, ctx)
    expect(dup.error).toContain('选项已存在')
  })

  test('renameField changes display name only; renameOption updates referencing records', async () => {
    const { project, sheet } = setupSheet()
    const ctx = makeContext(project.id)
    const record = spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: 'x', level: 'P0' }, createdBy: 'user' })

    const renamed = await ok('spreadsheet_manage_schema', { table: 'bug-list', action: 'renameField', fieldKey: 'level', name: '严重程度' }, ctx)
    expect((renamed.fields as Array<{ key: string; name: string }>).find((field) => field.key === 'level')?.name).toBe('严重程度')

    // renameOption 同步更新引用记录
    const opt = await ok('spreadsheet_manage_schema', { table: 'bug-list', action: 'renameOption', fieldKey: 'level', from: 'P0', to: 'P0-紧急' }, ctx)
    expect(opt.updatedRecords).toBe(1)
    const after = spreadsheetRecordStore.get(record.id)
    expect(after && parseRecordData(after).level).toBe('P0-紧急')

    // 不存在的选项 / 目标重名 报错
    const missing = await fail('spreadsheet_manage_schema', { table: 'bug-list', action: 'renameOption', fieldKey: 'level', from: 'P9', to: 'PX' }, ctx)
    expect(missing.error).toContain('选项不存在')
    const dupTarget = await fail('spreadsheet_manage_schema', { table: 'bug-list', action: 'renameOption', fieldKey: 'level', from: 'P0-紧急', to: 'P1' }, ctx)
    expect(dupTarget.error).toContain('已存在')

    void sheet
  })

  test('removeField confirm protocol: refused without confirm, executes with confirm, data preserved', async () => {
    const { project, sheet } = setupSheet()
    const ctx = makeContext(project.id)
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: 'x', level: 'P0' }, createdBy: 'user' })
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: 'y' }, createdBy: 'user' })

    // 影响面 1 条 → 未 confirm 拒绝
    const refused = await fail('spreadsheet_manage_schema', { table: 'bug-list', action: 'removeField', fieldKey: 'level' }, ctx)
    expect(refused.action).toBe('removeField')
    expect(refused.affectedRecords).toBe(1)
    // schema 未变
    expect(parseSchema(spreadsheetStore.get(sheet.id)!).fields).toHaveLength(5)

    // 带 confirm 执行：字段从 schema 移除，但 data_json 保留
    const confirmed = await ok('spreadsheet_manage_schema', { table: 'bug-list', action: 'removeField', fieldKey: 'level', confirm: true }, ctx)
    expect(confirmed.dataPreserved).toBe(true)
    expect(parseSchema(spreadsheetStore.get(sheet.id)!).fields).toHaveLength(4)
    const row = spreadsheetRecordStore.list(sheet.id)[0]
    expect(parseRecordData(row).level).toBe('P0') // 数据还在，可恢复

    // affectedRecords=0 时直接执行，不要求 confirm
    await ok('spreadsheet_manage_schema', { table: 'bug-list', action: 'removeField', fieldKey: 'due' }, ctx)
    expect(parseSchema(spreadsheetStore.get(sheet.id)!).fields).toHaveLength(3)
  })

  test('removeOption confirm protocol and value preservation', async () => {
    const { project, sheet } = setupSheet()
    const ctx = makeContext(project.id)
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: 'x', level: 'P1' }, createdBy: 'user' })

    const refused = await fail('spreadsheet_manage_schema', { table: 'bug-list', action: 'removeOption', fieldKey: 'level', name: 'P1' }, ctx)
    expect(refused.action).toBe('removeOption')
    expect(refused.affectedRecords).toBe(1)

    const confirmed = await ok('spreadsheet_manage_schema', { table: 'bug-list', action: 'removeOption', fieldKey: 'level', name: 'P1', confirm: true }, ctx)
    expect(confirmed.valuesPreserved).toBe(true)
    const row = spreadsheetRecordStore.list(sheet.id)[0]
    expect(parseRecordData(row).level).toBe('P1') // 值保留（渲染灰色兜底）
    const level = parseSchema(spreadsheetStore.get(sheet.id)!).fields.find((field) => field.key === 'level')
    expect(level?.options?.map((option) => option.n)).toEqual(['P0'])

    void sheet
  })

  test('changeFieldType converts existing values, nulls failures, and respects confirm protocol', async () => {
    const { project, sheet } = setupSheet()
    const ctx = makeContext(project.id)
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: '3', score: '4.5' }, createdBy: 'user' })
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { title: '无法转换', score: 'abc' }, createdBy: 'user' })
    spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data: { score: 9 }, createdBy: 'user' }) // title 为空，不参与转换

    // score 当前是 number；先把 title（text，2 条有值）改成 number → 验证 confirm
    const refused = await fail('spreadsheet_manage_schema', { table: 'bug-list', action: 'changeFieldType', fieldKey: 'title', type: 'number' }, ctx)
    expect(refused.action).toBe('changeFieldType')
    expect(refused.affectedRecords).toBe(2)

    // 带 confirm：'3'→3 成功，'无法转换'→NaN 置 null，报告 1 条失败
    const confirmed = await ok('spreadsheet_manage_schema', { table: 'bug-list', action: 'changeFieldType', fieldKey: 'title', type: 'number', confirm: true }, ctx)
    expect(confirmed.affectedRecords).toBe(2)
    expect(confirmed.converted).toBe(1)
    expect(confirmed.failedToNull).toBe(1)
    expect(confirmed.report).toContain('1 条转换失败已置空')
    const rows = spreadsheetRecordStore.list(sheet.id)
    expect(parseRecordData(rows[0]).title).toBe(3)
    expect(parseRecordData(rows[1]).title).toBe(null)
    expect(parseRecordData(rows[2]).title).toBeUndefined() // 空值记录不动

    // affectedRecords=0 的字段直接执行（due 无任何数据）
    const empty = await ok('spreadsheet_manage_schema', { table: 'bug-list', action: 'changeFieldType', fieldKey: 'due', type: 'checkbox' }, ctx)
    expect((empty.fields as Array<{ key: string; type: string }>).find((field) => field.key === 'due')?.type).toBe('checkbox')

    // text → singleSelect：按 options 匹配，不匹配置 null
    const toSelect = await ok('spreadsheet_manage_schema', {
      table: 'bug-list',
      action: 'changeFieldType',
      fieldKey: 'title',
      type: 'singleSelect',
      options: ['bug', 'feature'],
      confirm: true,
    }, ctx)
    expect((toSelect.fields as Array<{ key: string; type: string }>).find((field) => field.key === 'title')?.type).toBe('singleSelect')

    void sheet
  })

  test('unknown action and missing fields error clearly', async () => {
    const { project } = setupSheet()
    const ctx = makeContext(project.id)
    const unknown = await fail('spreadsheet_manage_schema', { table: 'bug-list', action: 'dropTable' }, ctx)
    expect(unknown.error).toContain('未知 action')
    const missingField = await fail('spreadsheet_manage_schema', { table: 'bug-list', action: 'renameField', fieldKey: 'nope', name: 'x' }, ctx)
    expect(missingField.error).toContain('字段不存在')
  })
})

describe('tool seed registration', () => {
  test('all four spreadsheet tools are registered in seed and handler map', () => {
    for (const name of ['spreadsheet_list_tables', 'spreadsheet_query_rows', 'spreadsheet_write_rows', 'spreadsheet_manage_schema']) {
      expect(getDb().prepare<[string], { name: string }>('SELECT name FROM tools WHERE name = ?').get(name)?.name).toBe(name)
      expect(getHandler(name)).toBeTruthy()
    }
  })

  test('write tool schema has no projectId parameter (project comes from session context)', () => {
    const tool = getDb().prepare<[string], { input_schema_json: string }>('SELECT input_schema_json FROM tools WHERE name = ?').get('spreadsheet_write_rows')
    const schema = JSON.parse(tool!.input_schema_json) as { properties: Record<string, unknown> }
    expect(schema.properties.projectId).toBeUndefined()
  })
})
