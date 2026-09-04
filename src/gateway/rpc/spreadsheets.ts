import {
  parseRecordData,
  parseSchema,
  parseView,
  spreadsheetRecordStore,
  spreadsheetStore,
  validateRowData,
  type SpreadsheetSchema,
  type SpreadsheetViewConfig,
} from '../../store/spreadsheets.js'
import type { RpcHandlerMap } from './types.js'

function requireOwner(authMode: 'owner' | 'guest'): void {
  if (authMode !== 'owner') throw new Error('访客无权访问表格（403）')
}

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`${field} 超长（最多 ${maxLength} 字符）`)
  return text
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`)
  const text = value.trim()
  if (!text) return undefined
  if (text.length > maxLength) throw new Error(`${field} 超长（最多 ${maxLength} 字符）`)
  return text
}

/** 表归属校验：给定的表必须存在，且属于给定项目（跨项目操作视为越权） */
function requireSheetInProject(spreadsheetId: string, projectId?: string): NonNullable<ReturnType<typeof spreadsheetStore.get>> {
  const sheet = spreadsheetStore.get(spreadsheetId)
  if (!sheet) throw new Error('表格不存在')
  if (projectId && sheet.project_id !== projectId) throw new Error('表格不属于当前项目（403）')
  return sheet
}

function parseSchemaInput(value: unknown, field: string): SpreadsheetSchema {
  if (!value || typeof value !== 'object' || !Array.isArray((value as SpreadsheetSchema).fields)) {
    throw new Error(`${field} 必须是 {fields:[...]}`)
  }
  return value as SpreadsheetSchema
}

function parseViewInput(value: unknown, field: string): SpreadsheetViewConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} 必须是对象`)
  }
  return value as SpreadsheetViewConfig
}

export const spreadsheetRpcHandlers: RpcHandlerMap = {
  'spreadsheets.list'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = requiredText(msg.projectId, 'projectId')
    const sheets = spreadsheetStore.list(projectId).map((sheet) => ({
      ...sheet,
      schema: parseSchema(sheet),
      view: parseView(sheet),
      recordCount: spreadsheetRecordStore.list(sheet.id).length,
    }))
    sendResult({ spreadsheets: sheets })
  },

  'spreadsheets.create'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const sheet = spreadsheetStore.create({
      projectId: requiredText(msg.projectId, 'projectId'),
      name: optionalText(msg.name, 'name', 80),
      title: requiredText(msg.title, 'title', 120),
      schema: msg.schema ? parseSchemaInput(msg.schema, 'schema') : undefined,
    })
    sendResult({ spreadsheet: { ...sheet, schema: parseSchema(sheet), view: parseView(sheet) } })
  },

  'spreadsheets.patch'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = optionalText(msg.projectId, 'projectId', 120)
    const sheet = requireSheetInProject(requiredText(msg.spreadsheetId, 'spreadsheetId'), projectId)
    const updated = spreadsheetStore.update(sheet.id, {
      title: optionalText(msg.title, 'title', 120),
      schema: msg.schema ? parseSchemaInput(msg.schema, 'schema') : undefined,
      view: msg.view ? parseViewInput(msg.view, 'view') : undefined,
    })
    sendResult({ spreadsheet: updated ? { ...updated, schema: parseSchema(updated), view: parseView(updated) } : undefined })
  },

  'spreadsheets.delete'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = optionalText(msg.projectId, 'projectId', 120)
    const sheet = requireSheetInProject(requiredText(msg.spreadsheetId, 'spreadsheetId'), projectId)
    const deleted = spreadsheetStore.remove(sheet.id)
    sendResult({ deleted })
  },

  'spreadsheet.records.list'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = optionalText(msg.projectId, 'projectId', 120)
    const sheet = requireSheetInProject(requiredText(msg.spreadsheetId, 'spreadsheetId'), projectId)
    const records = spreadsheetRecordStore.list(sheet.id).map((record) => ({
      ...record,
      data: parseRecordData(record),
    }))
    sendResult({ records })
  },

  'spreadsheet.records.create'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = optionalText(msg.projectId, 'projectId', 120)
    const sheet = requireSheetInProject(requiredText(msg.spreadsheetId, 'spreadsheetId'), projectId)
    const data = (msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data) ? msg.data : {}) as Record<string, unknown>
    const issues = validateRowData(parseSchema(sheet), data)
    if (issues.length > 0) {
      throw new Error(`记录校验失败：${issues.map((issue) => issue.message).join('；')}`)
    }
    const record = spreadsheetRecordStore.create({ spreadsheetId: sheet.id, data, createdBy: 'user' })
    sendResult({ record: { ...record, data: parseRecordData(record) } })
  },

  'spreadsheet.records.patch'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const record = spreadsheetRecordStore.get(requiredText(msg.recordId, 'recordId'))
    if (!record) throw new Error('记录不存在')
    const projectId = optionalText(msg.projectId, 'projectId', 120)
    const sheet = requireSheetInProject(record.spreadsheet_id, projectId)
    const data = (msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data) ? msg.data : {}) as Record<string, unknown>
    const issues = validateRowData(parseSchema(sheet), data)
    if (issues.length > 0) {
      throw new Error(`记录校验失败：${issues.map((issue) => issue.message).join('；')}`)
    }
    const updated = spreadsheetRecordStore.updateData(record.id, data)
    sendResult({ record: updated ? { ...updated, data: parseRecordData(updated) } : undefined })
  },

  'spreadsheet.records.delete'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const record = spreadsheetRecordStore.get(requiredText(msg.recordId, 'recordId'))
    if (!record) throw new Error('记录不存在')
    requireSheetInProject(record.spreadsheet_id, optionalText(msg.projectId, 'projectId', 120))
    sendResult({ deleted: spreadsheetRecordStore.remove(record.id) })
  },

  'spreadsheet.records.reorder'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = optionalText(msg.projectId, 'projectId', 120)
    const sheet = requireSheetInProject(requiredText(msg.spreadsheetId, 'spreadsheetId'), projectId)
    const recordIds = Array.isArray(msg.recordIds)
      ? msg.recordIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : []
    if (recordIds.length === 0) throw new Error('recordIds 不能为空')
    spreadsheetRecordStore.reorder(sheet.id, recordIds)
    const records = spreadsheetRecordStore.list(sheet.id).map((record) => ({
      ...record,
      data: parseRecordData(record),
    }))
    sendResult({ records })
  },
}
