import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

/** MVP 5 种字段类型（方案 §1.1） */
export type SpreadsheetFieldType = 'text' | 'number' | 'singleSelect' | 'date' | 'checkbox'

export interface SpreadsheetFieldOption {
  n: string
  c: string
}

export interface SpreadsheetField {
  key: string
  name: string
  type: SpreadsheetFieldType
  w?: number
  options?: SpreadsheetFieldOption[]
}

export type SpreadsheetSchema = { fields: SpreadsheetField[] }

/** 视图配置：列序/列宽/隐藏字段/单字段排序（方案 §1.2） */
export interface SpreadsheetViewConfig {
  colOrder?: string[]
  colWidths?: Record<string, number>
  hidden?: string[]
  sort?: { key: string; dir: 1 | -1 }
}

export interface SpreadsheetRow {
  id: string
  project_id: string
  name: string
  title: string
  schema_json: string
  view_json: string
  created_at: string
  updated_at: string
}

export interface SpreadsheetRecordRow {
  id: string
  spreadsheet_id: string
  data_json: string
  sort: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface CreateSpreadsheetInput {
  projectId: string
  name?: string
  title: string
  schema?: SpreadsheetSchema
}

export const DEFAULT_NEW_TABLE_FIELDS: SpreadsheetField[] = [
  { key: 'title', name: '标题', type: 'text', w: 260 },
  {
    key: 'status',
    name: '状态',
    type: 'singleSelect',
    w: 110,
    options: [
      { n: '待处理', c: 'red' },
      { n: '进行中', c: 'blue' },
      { n: '已完成', c: 'green' },
    ],
  },
  { key: 'due', name: '日期', type: 'date', w: 120 },
]

/** 单选标签自动配色（平台单选标签色板顺序） */
export const OPTION_PALETTE = ['blue', 'green', 'purple', 'orange', 'red', 'yellow', 'gray']

export function nextOptionColor(index: number): string {
  return OPTION_PALETTE[index % OPTION_PALETTE.length]
}

const FIELD_TYPES: readonly SpreadsheetFieldType[] = ['text', 'number', 'singleSelect', 'date', 'checkbox']

export function isSpreadsheetFieldType(value: unknown): value is SpreadsheetFieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value)
}

function toRow(row: Record<string, unknown>): SpreadsheetRow {
  return row as unknown as SpreadsheetRow
}

function toRecordRow(row: Record<string, unknown>): SpreadsheetRecordRow {
  return row as unknown as SpreadsheetRecordRow
}

export function parseSchema(row: SpreadsheetRow): SpreadsheetSchema {
  try {
    const parsed = JSON.parse(row.schema_json) as SpreadsheetSchema
    if (parsed && Array.isArray(parsed.fields)) return parsed
  } catch {
    // schema 损坏时回退空 schema，由上层自行处理
  }
  return { fields: [] }
}

export function parseView(row: SpreadsheetRow): SpreadsheetViewConfig {
  try {
    const parsed = JSON.parse(row.view_json) as SpreadsheetViewConfig
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function parseRecordData(row: SpreadsheetRecordRow): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.data_json) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface RowValidationIssue {
  fieldKey: string
  message: string
}

/**
 * 按 schema 校验一行数据（方案 §2.0 写入校验）：
 * 空值（null/undefined/''）视为未填，任何类型都合法；
 * singleSelect 必须是已有选项、date 必须 YYYY-MM-DD、number 必须数字、checkbox 必须布尔。
 */
export function validateRowData(schema: SpreadsheetSchema, data: Record<string, unknown>): RowValidationIssue[] {
  const issues: RowValidationIssue[] = []
  for (const field of schema.fields) {
    const value = data[field.key]
    if (value === undefined || value === null || value === '') continue
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({ fieldKey: field.key, message: `字段「${field.name}」必须是数字` })
      }
      continue
    }
    if (field.type === 'date') {
      if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
        issues.push({ fieldKey: field.key, message: `字段「${field.name}」必须是 YYYY-MM-DD 日期` })
      }
      continue
    }
    if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') {
        issues.push({ fieldKey: field.key, message: `字段「${field.name}」必须是 true/false` })
      }
      continue
    }
    if (field.type === 'singleSelect') {
      const options = field.options ?? []
      const legal = options.map((option) => option.n)
      if (!legal.includes(value as string)) {
        issues.push({ fieldKey: field.key, message: `字段「${field.name}」必须是以下选项之一：${legal.join('、') || '（暂无选项）'}` })
      }
    }
  }
  return issues
}

function nextSortBase(spreadsheetId: string): number {
  const row = getDb()
    .prepare<[string], { max: number | null }>(
      'SELECT MAX(sort) AS max FROM spreadsheet_records WHERE spreadsheet_id = ?',
    )
    .get(spreadsheetId)
  return (row?.max ?? 0) + 1
}

export const spreadsheetStore = {
  list(projectId: string): SpreadsheetRow[] {
    return getDb()
      .prepare<[string], Record<string, unknown>>(
        'SELECT * FROM spreadsheets WHERE project_id = ? ORDER BY created_at DESC, id DESC',
      )
      .all(projectId)
      .map(toRow)
  },

  get(id: string): SpreadsheetRow | undefined {
    return getDb().prepare<[string], Record<string, unknown>>('SELECT * FROM spreadsheets WHERE id = ?').get(id) as
      | SpreadsheetRow
      | undefined
  },

  findByName(projectId: string, name: string): SpreadsheetRow | undefined {
    return getDb()
      .prepare<[string, string], Record<string, unknown>>(
        'SELECT * FROM spreadsheets WHERE project_id = ? AND name = ?',
      )
      .get(projectId, name) as SpreadsheetRow | undefined
  },

  create(input: CreateSpreadsheetInput): SpreadsheetRow {
    const now = new Date().toISOString()
    const name = (input.name?.trim() || `tbl-${randomUUID().slice(0, 8)}`).toLowerCase()
    const duplicate = this.findByName(input.projectId, name)
    if (duplicate) throw new Error(`表格 AI 短名已存在：${name}`)
    const row: SpreadsheetRow = {
      id: `sheet-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId,
      name,
      title: input.title.trim(),
      schema_json: JSON.stringify(input.schema ?? { fields: DEFAULT_NEW_TABLE_FIELDS }),
      view_json: '{}',
      created_at: now,
      updated_at: now,
    }
    getDb()
      .prepare(
        `INSERT INTO spreadsheets (id, project_id, name, title, schema_json, view_json, created_at, updated_at)
         VALUES (@id, @project_id, @name, @title, @schema_json, @view_json, @created_at, @updated_at)`,
      )
      .run(row as unknown as Record<string, unknown>)
    return row
  },

  update(
    id: string,
    patch: { title?: string; schema?: SpreadsheetSchema; view?: SpreadsheetViewConfig },
  ): SpreadsheetRow | undefined {
    const existing = this.get(id)
    if (!existing) return undefined
    const updated: SpreadsheetRow = {
      ...existing,
      title: patch.title?.trim() || existing.title,
      schema_json: patch.schema ? JSON.stringify(patch.schema) : existing.schema_json,
      view_json: patch.view ? JSON.stringify(patch.view) : existing.view_json,
      updated_at: new Date().toISOString(),
    }
    getDb()
      .prepare(
        `UPDATE spreadsheets SET title = @title, schema_json = @schema_json, view_json = @view_json, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(updated as unknown as Record<string, unknown>)
    return this.get(id)
  },

  /** 删表并级联删记录（不依赖 PRAGMA foreign_keys，事务内手动级联） */
  remove(id: string): boolean {
    const existing = this.get(id)
    if (!existing) return false
    getDb().transaction(() => {
      getDb().prepare('DELETE FROM spreadsheet_records WHERE spreadsheet_id = ?').run(id)
      getDb().prepare('DELETE FROM spreadsheets WHERE id = ?').run(id)
    })()
    return true
  },
}

export const spreadsheetRecordStore = {
  list(spreadsheetId: string): SpreadsheetRecordRow[] {
    return getDb()
      .prepare<[string], Record<string, unknown>>(
        'SELECT * FROM spreadsheet_records WHERE spreadsheet_id = ? ORDER BY sort ASC, created_at ASC, id ASC',
      )
      .all(spreadsheetId)
      .map(toRecordRow)
  },

  get(id: string): SpreadsheetRecordRow | undefined {
    return getDb()
      .prepare<[string], Record<string, unknown>>('SELECT * FROM spreadsheet_records WHERE id = ?')
      .get(id) as SpreadsheetRecordRow | undefined
  },

  create(input: { spreadsheetId: string; data: Record<string, unknown>; createdBy: string }): SpreadsheetRecordRow {
    const sheet = spreadsheetStore.get(input.spreadsheetId)
    if (!sheet) throw new Error(`表格不存在: ${input.spreadsheetId}`)
    const now = new Date().toISOString()
    const row: SpreadsheetRecordRow = {
      id: `rec-${randomUUID().slice(0, 12)}`,
      spreadsheet_id: input.spreadsheetId,
      data_json: JSON.stringify(input.data ?? {}),
      sort: nextSortBase(input.spreadsheetId),
      created_by: input.createdBy,
      created_at: now,
      updated_at: now,
    }
    getDb()
      .prepare(
        `INSERT INTO spreadsheet_records (id, spreadsheet_id, data_json, sort, created_by, created_at, updated_at)
         VALUES (@id, @spreadsheet_id, @data_json, @sort, @created_by, @created_at, @updated_at)`,
      )
      .run(row as unknown as Record<string, unknown>)
    return row
  },

  updateData(id: string, data: Record<string, unknown>): SpreadsheetRecordRow | undefined {
    const existing = this.get(id)
    if (!existing) return undefined
    const updated: SpreadsheetRecordRow = {
      ...existing,
      data_json: JSON.stringify(data ?? {}),
      updated_at: new Date().toISOString(),
    }
    getDb()
      .prepare(
        'UPDATE spreadsheet_records SET data_json = @data_json, updated_at = @updated_at WHERE id = @id',
      )
      .run(updated as unknown as Record<string, unknown>)
    return this.get(id)
  },

  remove(id: string): boolean {
    const result = getDb().prepare('DELETE FROM spreadsheet_records WHERE id = ?').run(id)
    return result.changes > 0
  },

  /** 行拖拽重排：按传入 id 顺序重写 sort（0,1,2…）；不在列表里的既有记录保持原 sort 排在其后 */
  reorder(spreadsheetId: string, orderedIds: string[]): void {
    const existing = spreadsheetStore.get(spreadsheetId)
    if (!existing) throw new Error(`表格不存在: ${spreadsheetId}`)
    getDb().transaction(() => {
      const update = getDb().prepare('UPDATE spreadsheet_records SET sort = ? WHERE id = ? AND spreadsheet_id = ?')
      orderedIds.forEach((id, index) => {
        update.run(index, id, spreadsheetId)
      })
    })()
  },
}
