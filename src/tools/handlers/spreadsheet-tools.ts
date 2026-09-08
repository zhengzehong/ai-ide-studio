import { randomUUID } from 'node:crypto'
import {
  nextOptionColor,
  parseRecordData,
  parseSchema,
  spreadsheetRecordStore,
  spreadsheetStore,
  validateRowData,
  type SpreadsheetField,
  type SpreadsheetFieldType,
  type SpreadsheetSchema,
  type SpreadsheetRow,
} from '../../store/spreadsheets.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

const DEFAULT_QUERY_LIMIT = 50
const MAX_QUERY_LIMIT = 200
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FIELD_TYPES: readonly SpreadsheetFieldType[] = ['text', 'number', 'singleSelect', 'date', 'checkbox']

// ---------------------------------------------------------------------------
// 共享 helper
// ---------------------------------------------------------------------------

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function errorResult(error: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error }) }], isError: true }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return text
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, field, maxLength)
}

/** 按名称（或 id）解析当前项目内的表；projectId 一律取自会话上下文，AI 不可指定 */
function resolveSheet(context: ToolContext, table: unknown): SpreadsheetRow {
  if (!context.projectId) throw new Error('当前会话未绑定项目，无法访问表格')
  const name = requiredText(table, 'table', 200)
  const sheet = spreadsheetStore.findByName(context.projectId, name) ?? spreadsheetStore.get(name)
  if (!sheet) throw new Error(`表格不存在：${name}（可先用 spreadsheet_list_tables 查看项目内所有表格）`)
  if (sheet.project_id !== context.projectId) throw new Error('表格不属于当前项目（403）')
  return sheet
}

function recordsWithData(sheetId: string): Array<{ id: string; data: Record<string, unknown>; raw: ReturnType<typeof spreadsheetRecordStore.get> }> {
  return spreadsheetRecordStore.list(sheetId).map((row) => ({
    id: row.id,
    data: parseRecordData(row),
    raw: row,
  }))
}

function findField(schema: SpreadsheetSchema, fieldKey: string): SpreadsheetField {
  const field = schema.fields.find((item) => item.key === fieldKey)
  if (!field) {
    throw new Error(`字段不存在：${fieldKey}，可用字段：${schema.fields.map((item) => item.key).join('、') || '（无）'}`)
  }
  return field
}

function countNonEmpty(records: Array<{ data: Record<string, unknown> }>, key: string): number {
  return records.filter(({ data }) => {
    const value = data[key]
    return value !== undefined && value !== null && value !== ''
  }).length
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

// ---------------------------------------------------------------------------
// 类型转换矩阵（方案 §2.2 changeFieldType：存量值自动转换，失败置 null）
// ---------------------------------------------------------------------------

function convertValue(
  value: unknown,
  type: SpreadsheetFieldType,
  optionNames: string[],
): { value: unknown; ok: boolean } {
  if (isEmptyValue(value)) return { value: null, ok: true }
  switch (type) {
    case 'text':
      return { value: typeof value === 'string' ? value : String(value), ok: true }
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return { value, ok: true }
      if (typeof value === 'string') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return { value: parsed, ok: true }
      }
      return { value: null, ok: false }
    }
    case 'date':
      return typeof value === 'string' && DATE_PATTERN.test(value) ? { value, ok: true } : { value: null, ok: false }
    case 'singleSelect':
      return optionNames.includes(String(value)) ? { value: String(value), ok: true } : { value: null, ok: false }
    case 'checkbox': {
      if (value === true || value === 'true' || value === 1) return { value: true, ok: true }
      if (value === false || value === 'false' || value === 0) return { value: false, ok: true }
      return { value: null, ok: false }
    }
    default:
      return { value: null, ok: false }
  }
}

function confirmRequiredResult(action: string, affectedRecords: number): ToolHandlerResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: `破坏性操作需要确认：${action} 将影响 ${affectedRecords} 条记录；请确认影响面后，带 confirm:true 重新调用`,
          action,
          affectedRecords,
        }),
      },
    ],
    isError: true,
  }
}

function isConfirmed(input: ToolHandlerInput): boolean {
  return input.confirm === true
}

// ---------------------------------------------------------------------------
// 1. spreadsheet_list_tables —— 发现项目内表格 + 字段定义（一次拿到 schema）
// ---------------------------------------------------------------------------

export const spreadsheetListTablesHandler: ToolHandler = {
  name: 'spreadsheet_list_tables',
  description:
    '列出当前项目内的所有表格，并附带每张表的字段定义（key、名称、类型、单选选项）与记录数。写数据前必须先调用本工具拿到表名与字段结构，不要猜测字段。',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      if (!context.projectId) throw new Error('当前会话未绑定项目，无法访问表格')
      const tables = spreadsheetStore.list(context.projectId).map((sheet) => ({
        id: sheet.id,
        name: sheet.name,
        title: sheet.title,
        fields: parseSchema(sheet).fields,
        recordCount: spreadsheetRecordStore.list(sheet.id).length,
        updatedAt: sheet.updated_at,
      }))
      return jsonResult({ tables })
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  },
}

// ---------------------------------------------------------------------------
// 2. spreadsheet_query_rows —— 读记录：filter AND 组合 / fields 投影 / limit/offset 分页
// ---------------------------------------------------------------------------

export const spreadsheetQueryRowsHandler: ToolHandler = {
  name: 'spreadsheet_query_rows',
  description:
    '读取指定表格的记录。支持 filter（多个条件 AND 组合）、fields（只返回指定字段）、limit（默认 50，最大 200）与 offset 分页。先写 field 的 key，不要写显示名。',
  inputSchema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: '表格短名（来自 spreadsheet_list_tables 的 name）' },
      filter: {
        type: 'object',
        description: '可选：过滤条件，{字段key: 值}，多个条件 AND 组合；文本字段按包含匹配，其余按相等匹配',
        additionalProperties: true,
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: '可选：只返回这些字段 key（投影）',
      },
      limit: { type: 'number', description: '可选：返回条数，默认 50，最大 200' },
      offset: { type: 'number', description: '可选：跳过条数，默认 0' },
    },
    required: ['table'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      const sheet = resolveSheet(context, input.table)
      const schema = parseSchema(sheet)
      const fieldKeys = schema.fields.map((field) => field.key)

      let records = recordsWithData(sheet.id)

      const filter = asRecord(input.filter)
      if (filter) {
        for (const [key] of Object.entries(filter)) {
          if (!fieldKeys.includes(key)) {
            throw new Error(`过滤字段不存在：${key}，可用字段：${fieldKeys.join('、') || '（无）'}`)
          }
        }
        records = records.filter(({ data }) =>
          Object.entries(filter).every(([key, filterValue]) => {
            const value = data[key]
            if (isEmptyValue(filterValue)) return isEmptyValue(value)
            if (isEmptyValue(value)) return false
            const field = schema.fields.find((item) => item.key === key)
            if (field?.type === 'text' || (typeof value === 'string' && typeof filterValue === 'string')) {
              return String(value).toLowerCase().includes(String(filterValue).toLowerCase())
            }
            if (field?.type === 'number') return Number(value) === Number(filterValue)
            if (field?.type === 'checkbox') {
              return Boolean(value) === (filterValue === true || filterValue === 'true')
            }
            return String(value) === String(filterValue)
          }),
        )
      }

      const projection = Array.isArray(input.fields) ? input.fields.filter((key): key is string => typeof key === 'string') : null
      if (projection) {
        for (const key of projection) {
          if (!fieldKeys.includes(key)) {
            throw new Error(`投影字段不存在：${key}，可用字段：${fieldKeys.join('、') || '（无）'}`)
          }
        }
      }

      const limitInput = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.floor(input.limit) : DEFAULT_QUERY_LIMIT
      const limit = Math.min(Math.max(limitInput, 1), MAX_QUERY_LIMIT)
      const offset = typeof input.offset === 'number' && Number.isFinite(input.offset) ? Math.max(Math.floor(input.offset), 0) : 0

      const projected = projection
        ? records.map(({ id, data }) => ({ id, data: Object.fromEntries(projection.map((key) => [key, data[key] ?? null])) }))
        : records.map(({ id, data }) => ({ id, data }))

      return jsonResult({
        total: projected.length,
        table: sheet.name,
        records: projected.slice(offset, offset + limit),
      })
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  },
}

// ---------------------------------------------------------------------------
// 3. spreadsheet_write_rows —— 写记录（append 追加 / update 按 recordId 修改）
// ---------------------------------------------------------------------------

const MAX_RECORDS_ROWS = 200

export const spreadsheetWriteRowsHandler: ToolHandler = {
  name: 'spreadsheet_write_rows',
  description:
    '向指定表格写入记录。mode=append 追加新行（rows 为 {字段key: 值} 的数组）；mode=update 修改已有行（每行额外带 recordId，只传要改的字段，其余保留）。数据按表 schema 校验：单选值必须是已有选项之一、日期必须 YYYY-MM-DD、数字必须是数字、勾选框必须 true/false，报错会列出合法取值，按报错自纠后重试。无删除能力。',
  inputSchema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: '表格短名（来自 spreadsheet_list_tables 的 name）' },
      mode: { type: 'string', enum: ['append', 'update'], description: 'append=追加新行；update=按 recordId 修改已有行' },
      rows: {
        type: 'array',
        maxItems: MAX_RECORDS_ROWS,
        items: { type: 'object', additionalProperties: true },
        description: '要写入的行数据数组；update 模式下每行需带 recordId',
      },
    },
    required: ['table', 'mode', 'rows'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      const sheet = resolveSheet(context, input.table)
      const schema = parseSchema(sheet)
      const mode = input.mode
      if (mode !== 'append' && mode !== 'update') throw new Error("mode 必须是 'append' 或 'update'")
      if (!Array.isArray(input.rows) || input.rows.length === 0) throw new Error('rows 不能为空')
      if (input.rows.length > MAX_RECORDS_ROWS) throw new Error(`rows 单次最多 ${MAX_RECORDS_ROWS} 行`)
      const createdBy = context.agentId ? `agent:${context.agentId}` : 'agent'

      const rowPayloads = input.rows.map((row, index) => {
        const record = asRecord(row)
        if (!record) throw new Error(`rows[${index}] 必须是对象`)
        return { index, record }
      })

      if (mode === 'append') {
        const prepared: Array<{ spreadsheetId: string; data: Record<string, unknown>; createdBy: string }> = []
        for (const { index, record } of rowPayloads) {
          const data = asRecord(record.data) ?? record
          const issues = validateRowData(schema, data)
          if (issues.length > 0) {
            const detail = issues.map((issue) => issue.message).join('；')
            throw new Error(`rows[${index}] 校验失败：${detail}（单选字段合法取值见报错，请修正后重试）`)
          }
          prepared.push({ spreadsheetId: sheet.id, data, createdBy })
        }
        const created = prepared.map((payload) => {
          const row = spreadsheetRecordStore.create(payload)
          return { id: row.id, data: parseRecordData(row), createdBy: row.created_by }
        })
        return jsonResult({ mode, created: created.length, records: created })
      }

      // update 模式：每行带 recordId，仅合并传入的字段
      const updates: Array<{ recordId: string; data: Record<string, unknown> }> = []
      for (const { index, record } of rowPayloads) {
        const recordId = requiredText(record.recordId, `rows[${index}].recordId`, 120)
        const existing = spreadsheetRecordStore.get(recordId)
        if (!existing || existing.spreadsheet_id !== sheet.id) {
          throw new Error(`rows[${index}] 的记录不存在或不属于该表：${recordId}`)
        }
        const patch = asRecord(record.data) ?? Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'recordId'))
        const merged = { ...parseRecordData(existing), ...patch }
        const issues = validateRowData(schema, merged)
        if (issues.length > 0) {
          const detail = issues.map((issue) => issue.message).join('；')
          throw new Error(`rows[${index}] 校验失败：${detail}（单选字段合法取值见报错，请修正后重试）`)
        }
        updates.push({ recordId, data: merged })
      }
      const updated = updates.map(({ recordId, data }) => {
        const row = spreadsheetRecordStore.updateData(recordId, data)
        return { id: recordId, data: row ? parseRecordData(row) : data }
      })
      return jsonResult({ mode, updated: updated.length, records: updated })
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  },
}

// ---------------------------------------------------------------------------
// 4. spreadsheet_manage_schema —— 字段/选项完整操作（7 个 action，破坏性走 confirm 协议）
// ---------------------------------------------------------------------------

export const spreadsheetManageSchemaHandler: ToolHandler = {
  name: 'spreadsheet_manage_schema',
  description:
    '管理表格结构（字段与单选选项），单工具统一入口，按 action 分发：addField 加字段 / renameField 改显示名 / changeFieldType 改类型（存量值自动转换，转不了的置 null 并报告） / removeField 删字段（数据保留在记录里，可恢复） / addOption 加单选选项（自动配色） / renameOption 改选项名（同步更新所有引用记录） / removeOption 删选项（已引用值保留，渲染兜底）。removeField、removeOption、changeFieldType 为破坏性操作：未带 confirm:true 且影响记录数大于 0 时不执行，报错返回影响面，确认后带 confirm:true 重试。',
  inputSchema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: '表格短名（来自 spreadsheet_list_tables 的 name）' },
      action: {
        type: 'string',
        enum: ['addField', 'renameField', 'changeFieldType', 'removeField', 'addOption', 'renameOption', 'removeOption'],
        description: '要执行的结构操作',
      },
      field: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '字段显示名' },
          type: { type: 'string', enum: ['text', 'number', 'singleSelect', 'date', 'checkbox'], description: '字段类型' },
          key: { type: 'string', description: '可选：字段 key（缺省由显示名生成或自动分配，冲突时报错）' },
          options: { type: 'array', items: { type: 'string' }, description: 'singleSelect 初始选项名列表（自动配色）' },
        },
        required: ['name', 'type'],
        description: 'addField 必填：新字段定义',
      },
      fieldKey: { type: 'string', description: '字段 key（renameField / changeFieldType / removeField / addOption / renameOption / removeOption 必填）' },
      name: { type: 'string', description: 'renameField：新的显示名' },
      type: { type: 'string', enum: ['text', 'number', 'singleSelect', 'date', 'checkbox'], description: 'changeFieldType：目标类型' },
      options: { type: 'array', items: { type: 'string' }, description: 'changeFieldType 目标为 singleSelect 时：新的选项名列表（自动配色）' },
      option: {
        type: 'object',
        properties: { name: { type: 'string', description: '选项名' } },
        required: ['name'],
        description: 'addOption 必填：要添加的选项',
      },
      from: { type: 'string', description: 'renameOption：原选项名' },
      to: { type: 'string', description: 'renameOption：新选项名' },
      confirm: { type: 'boolean', description: '破坏性操作（removeField/removeOption/changeFieldType）二次确认；首次调用不传，看到影响面后确认再传 true' },
    },
    required: ['table', 'action'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      const sheet = resolveSheet(context, input.table)
      const action = requiredText(input.action, 'action', 40)
      const schema = parseSchema(sheet)
      const records = recordsWithData(sheet.id)

      switch (action) {
        case 'addField': {
          const fieldInput = asRecord(input.field)
          if (!fieldInput) throw new Error('addField 需要提供 field: {name, type, options?}')
          const name = requiredText(fieldInput.name, 'field.name', 100)
          const type = fieldInput.type
          if (!FIELD_TYPES.includes(type as SpreadsheetFieldType)) {
            throw new Error(`field.type 必须是以下之一：${FIELD_TYPES.join('、')}`)
          }
          const optionNames = Array.isArray(fieldInput.options)
            ? fieldInput.options.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : []
          const explicitKey = optionalText(fieldInput.key, 'field.key', 60)
          let key = explicitKey ?? (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `f-${randomUUID().slice(0, 8)}`)
          while (schema.fields.some((item) => item.key === key)) {
            if (explicitKey) throw new Error(`字段 key 已存在：${key}`)
            key = `f-${randomUUID().slice(0, 8)}`
          }
          const field: SpreadsheetField = {
            key,
            name,
            type: type as SpreadsheetFieldType,
            w: 120,
          }
          if (type === 'singleSelect') {
            field.options = optionNames.map((optionName, index) => ({ n: optionName, c: nextOptionColor(index) }))
          }
          const nextSchema: SpreadsheetSchema = { fields: [...schema.fields, field] }
          spreadsheetStore.update(sheet.id, { schema: nextSchema })
          return jsonResult({ action, addedField: field, fields: nextSchema.fields })
        }

        case 'renameField': {
          const fieldKey = requiredText(input.fieldKey, 'fieldKey', 100)
          const newName = requiredText(input.name, 'name', 100)
          findField(schema, fieldKey)
          const nextSchema: SpreadsheetSchema = {
            fields: schema.fields.map((item) => (item.key === fieldKey ? { ...item, name: newName } : item)),
          }
          spreadsheetStore.update(sheet.id, { schema: nextSchema })
          return jsonResult({ action, renamedField: { key: fieldKey, name: newName }, fields: nextSchema.fields })
        }

        case 'changeFieldType': {
          const fieldKey = requiredText(input.fieldKey, 'fieldKey', 100)
          const targetType = input.type
          if (!FIELD_TYPES.includes(targetType as SpreadsheetFieldType)) {
            throw new Error(`type 必须是以下之一：${FIELD_TYPES.join('、')}`)
          }
          const field = findField(schema, fieldKey)
          const affectedRecords = countNonEmpty(records, fieldKey)
          if (!isConfirmed(input) && affectedRecords > 0) {
            return confirmRequiredResult(action, affectedRecords)
          }
          const targetOptionNames = Array.isArray(input.options)
            ? input.options.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : undefined
          let nextOptions: SpreadsheetField['options']
          if (targetType === 'singleSelect') {
            nextOptions = (targetOptionNames ?? field.options?.map((option) => option.n) ?? []).map(
              (optionName, index) => ({ n: optionName, c: nextOptionColor(index) }),
            )
          }
          let failedToNull = 0
          for (const { id, data } of records) {
            if (!(fieldKey in data)) continue
            const { value, ok } = convertValue(data[fieldKey], targetType as SpreadsheetFieldType, (nextOptions ?? []).map((option) => option.n))
            if (!ok) failedToNull += 1
            const nextData = { ...data, [fieldKey]: value }
            if (JSON.stringify(nextData) !== JSON.stringify(data)) spreadsheetRecordStore.updateData(id, nextData)
          }
          const nextSchema: SpreadsheetSchema = {
            fields: schema.fields.map((item) =>
              item.key === fieldKey ? { ...item, type: targetType as SpreadsheetFieldType, ...(nextOptions ? { options: nextOptions } : {}) } : item,
            ),
          }
          spreadsheetStore.update(sheet.id, { schema: nextSchema })
          return jsonResult({
            action,
            fieldKey,
            type: targetType,
            affectedRecords,
            converted: affectedRecords - failedToNull,
            failedToNull,
            report: failedToNull > 0 ? `${failedToNull} 条转换失败已置空` : '全部存量值转换成功',
            fields: nextSchema.fields,
          })
        }

        case 'removeField': {
          const fieldKey = requiredText(input.fieldKey, 'fieldKey', 100)
          findField(schema, fieldKey)
          const affectedRecords = countNonEmpty(records, fieldKey)
          if (!isConfirmed(input) && affectedRecords > 0) {
            return confirmRequiredResult(action, affectedRecords)
          }
          // 数据不物理清：只从 schema 移除字段，data_json 保留，重建同 key 字段可找回
          const nextSchema: SpreadsheetSchema = { fields: schema.fields.filter((item) => item.key !== fieldKey) }
          spreadsheetStore.update(sheet.id, { schema: nextSchema })
          return jsonResult({ action, removedField: fieldKey, affectedRecords, dataPreserved: true, fields: nextSchema.fields })
        }

        case 'addOption': {
          const fieldKey = requiredText(input.fieldKey, 'fieldKey', 100)
          const field = findField(schema, fieldKey)
          if (field.type !== 'singleSelect') throw new Error(`字段 ${fieldKey} 不是单选类型，无法添加选项`)
          const optionInput = asRecord(input.option)
          if (!optionInput) throw new Error('addOption 需要提供 option: {name}')
          const optionName = requiredText(optionInput.name, 'option.name', 100)
          const existingOptions = field.options ?? []
          if (existingOptions.some((option) => option.n === optionName)) {
            throw new Error(`选项已存在：${optionName}，现有选项：${existingOptions.map((option) => option.n).join('、')}`)
          }
          const nextOptions = [...existingOptions, { n: optionName, c: nextOptionColor(existingOptions.length) }]
          const nextSchema: SpreadsheetSchema = {
            fields: schema.fields.map((item) => (item.key === fieldKey ? { ...item, options: nextOptions } : item)),
          }
          spreadsheetStore.update(sheet.id, { schema: nextSchema })
          return jsonResult({ action, fieldKey, addedOption: nextOptions[nextOptions.length - 1], options: nextOptions })
        }

        case 'renameOption': {
          const fieldKey = requiredText(input.fieldKey, 'fieldKey', 100)
          const from = requiredText(input.from, 'from', 100)
          const to = requiredText(input.to, 'to', 100)
          const field = findField(schema, fieldKey)
          if (field.type !== 'singleSelect') throw new Error(`字段 ${fieldKey} 不是单选类型`)
          const existingOptions = field.options ?? []
          if (!existingOptions.some((option) => option.n === from)) {
            throw new Error(`选项不存在：${from}，现有选项：${existingOptions.map((option) => option.n).join('、') || '（无）'}`)
          }
          if (existingOptions.some((option) => option.n === to)) throw new Error(`目标选项名已存在：${to}`)
          const nextSchema: SpreadsheetSchema = {
            fields: schema.fields.map((item) =>
              item.key === fieldKey
                ? { ...item, options: existingOptions.map((option) => (option.n === from ? { ...option, n: to } : option)) }
                : item,
            ),
          }
          spreadsheetStore.update(sheet.id, { schema: nextSchema })
          // 同步更新所有引用记录的值
          let updatedRecords = 0
          for (const { id, data } of records) {
            if (data[fieldKey] === from) {
              spreadsheetRecordStore.updateData(id, { ...data, [fieldKey]: to })
              updatedRecords += 1
            }
          }
          return jsonResult({ action, fieldKey, from, to, updatedRecords, options: nextSchema.fields.find((item) => item.key === fieldKey)?.options })
        }

        case 'removeOption': {
          const fieldKey = requiredText(input.fieldKey, 'fieldKey', 100)
          const optionName = requiredText(input.name ?? input.optionName, 'name', 100)
          const field = findField(schema, fieldKey)
          if (field.type !== 'singleSelect') throw new Error(`字段 ${fieldKey} 不是单选类型`)
          const existingOptions = field.options ?? []
          if (!existingOptions.some((option) => option.n === optionName)) {
            throw new Error(`选项不存在：${optionName}，现有选项：${existingOptions.map((option) => option.n).join('、') || '（无）'}`)
          }
          const affectedRecords = records.filter(({ data }) => data[fieldKey] === optionName).length
          if (!isConfirmed(input) && affectedRecords > 0) {
            return confirmRequiredResult(action, affectedRecords)
          }
          // 值保留：引用记录的 data_json 不动，渲染时灰色兜底
          const nextSchema: SpreadsheetSchema = {
            fields: schema.fields.map((item) =>
              item.key === fieldKey ? { ...item, options: existingOptions.filter((option) => option.n !== optionName) } : item,
            ),
          }
          spreadsheetStore.update(sheet.id, { schema: nextSchema })
          return jsonResult({ action, fieldKey, removedOption: optionName, affectedRecords, valuesPreserved: true, options: nextSchema.fields.find((item) => item.key === fieldKey)?.options })
        }

        default:
          throw new Error(`未知 action：${action}`)
      }
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  },
}

// ---------------------------------------------------------------------------
// 5. spreadsheet_create_table —— 建表：默认字段模板或自定义字段（singleSelect 自动配色）
// ---------------------------------------------------------------------------

/** 建表入参 fields → SpreadsheetSchema：key 显式或由显示名生成，singleSelect 选项自动配色 */
function buildSchemaFromFieldInput(raw: unknown): SpreadsheetSchema {
  const items = Array.isArray(raw) ? raw : null
  if (!items || items.length === 0) {
    throw new Error('fields 需要是非空数组；如需默认字段（标题/状态/日期）请不要传 fields')
  }
  const fields = items.map((item, index) => {
    const record = asRecord(item)
    if (!record) throw new Error(`fields[${index}] 必须是对象`)
    const fieldName = requiredText(record.name, `fields[${index}].name`, 100)
    const type = record.type
    if (!FIELD_TYPES.includes(type as SpreadsheetFieldType)) {
      throw new Error(`fields[${index}].type 必须是以下之一：${FIELD_TYPES.join('、')}`)
    }
    const optionNames = Array.isArray(record.options)
      ? record.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
      : []
    const explicitKey = optionalText(record.key, `fields[${index}].key`, 60)
    const key = explicitKey ?? (/^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldName) ? fieldName : `f-${randomUUID().slice(0, 8)}`)
    const field: SpreadsheetField = { key, name: fieldName, type: type as SpreadsheetFieldType, w: 120 }
    if (type === 'singleSelect') {
      field.options = optionNames.map((optionName, optionIndex) => ({ n: optionName, c: nextOptionColor(optionIndex) }))
    }
    return field
  })
  const seen = new Set<string>()
  for (const field of fields) {
    if (seen.has(field.key)) throw new Error(`字段 key 重复：${field.key}`)
    seen.add(field.key)
  }
  return { fields }
}

export const spreadsheetCreateTableHandler: ToolHandler = {
  name: 'spreadsheet_create_table',
  description:
    '在当前项目内新建一张空表。不传 fields 时使用默认字段（标题 text / 状态 singleSelect：待处理、进行中、已完成 / 日期 date）；可用 fields 自定义字段（类型 text/number/singleSelect/date/checkbox，singleSelect 选项自动配色）。name 在项目内唯一，建表后用 spreadsheet_write_rows 写数据。',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '表格 AI 短名（项目内唯一，后续 query/write/manage_schema 均用它引用）' },
      title: { type: 'string', description: '可选：显示名，缺省同 name' },
      fields: {
        type: 'array',
        description:
          '可选：字段定义列表，每个元素为 {name, type, key?, options?}——name 字段显示名；type 为 text/number/singleSelect/date/checkbox 之一；key 可选（缺省由英文显示名生成或自动分配）；options 为 singleSelect 的选项名列表（自动配色）。缺省整个 fields 时使用默认字段（标题/状态/日期）',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '字段显示名' },
            type: { type: 'string', enum: ['text', 'number', 'singleSelect', 'date', 'checkbox'], description: '字段类型' },
            key: { type: 'string', description: '可选：字段 key（缺省由显示名生成或自动分配）' },
            options: { type: 'array', items: { type: 'string' }, description: 'singleSelect 选项名列表（自动配色）' },
          },
          required: ['name', 'type'],
        },
      },
    },
    required: ['name'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      if (!context.projectId) throw new Error('当前会话未绑定项目，无法访问表格')
      const name = requiredText(input.name, 'name', 60)
      const title = optionalText(input.title, 'title', 120) ?? name
      const schema = input.fields === undefined ? undefined : buildSchemaFromFieldInput(input.fields)
      const sheet = spreadsheetStore.create({
        projectId: context.projectId,
        name,
        title,
        ...(schema ? { schema } : {}),
      })
      return jsonResult({
        id: sheet.id,
        name: sheet.name,
        title: sheet.title,
        fields: parseSchema(sheet).fields,
        recordCount: 0,
      })
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  },
}
