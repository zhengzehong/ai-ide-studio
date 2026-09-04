import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

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

export interface SpreadsheetSchema {
  fields: SpreadsheetField[]
}

export interface SpreadsheetViewConfig {
  colOrder?: string[]
  colWidths?: Record<string, number>
  hidden?: string[]
  sort?: { key: string; dir: 1 | -1 }
}

export interface SpreadsheetSummary {
  id: string
  project_id: string
  name: string
  title: string
  schema_json: string
  view_json: string
  created_at: string
  updated_at: string
  schema: SpreadsheetSchema
  view: SpreadsheetViewConfig
  recordCount: number
}

export interface SpreadsheetRecord {
  id: string
  spreadsheet_id: string
  data_json: string
  sort: number
  created_by: string
  created_at: string
  updated_at: string
  data: Record<string, unknown>
}

interface SpreadsheetState {
  tables: SpreadsheetSummary[]
  activeTableId: string | null
  records: SpreadsheetRecord[]
  loading: boolean
  recordsLoading: boolean
  error: string | null
  loadTables: (projectId: string) => Promise<void>
  selectTable: (spreadsheetId: string | null) => void
  loadRecords: (projectId: string, spreadsheetId: string) => Promise<void>
  createTable: (projectId: string, title: string) => Promise<SpreadsheetSummary | null>
  removeTable: (projectId: string, spreadsheetId: string) => Promise<void>
  patchTable: (
    projectId: string,
    spreadsheetId: string,
    patch: { title?: string; schema?: SpreadsheetSchema; view?: SpreadsheetViewConfig },
  ) => Promise<void>
  createRecord: (projectId: string, spreadsheetId: string, data: Record<string, unknown>) => Promise<void>
  patchRecord: (projectId: string, recordId: string, data: Record<string, unknown>) => Promise<void>
  removeRecord: (projectId: string, recordId: string) => Promise<void>
  reorderRecords: (projectId: string, spreadsheetId: string, recordIds: string[]) => Promise<void>
}

async function request<T>(payload: Record<string, unknown>): Promise<T> {
  return (await wsClient.request(payload)) as T
}

export const useSpreadsheetStore = create<SpreadsheetState>((set, get) => ({
  tables: [],
  activeTableId: null,
  records: [],
  loading: false,
  recordsLoading: false,
  error: null,

  async loadTables(projectId) {
    set({ loading: true, error: null })
    try {
      const data = await request<{ spreadsheets: SpreadsheetSummary[] }>({ type: 'spreadsheets.list', projectId })
      const tables = data.spreadsheets ?? []
      const activeTableId = get().activeTableId
      const stillThere = activeTableId && tables.some((table) => table.id === activeTableId)
      set({ tables, loading: false, activeTableId: stillThere ? activeTableId : (tables[0]?.id ?? null) })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  selectTable(spreadsheetId) {
    set({ activeTableId: spreadsheetId, records: [] })
  },

  async loadRecords(projectId, spreadsheetId) {
    set({ recordsLoading: true, error: null })
    try {
      const data = await request<{ records: SpreadsheetRecord[] }>({
        type: 'spreadsheet.records.list',
        projectId,
        spreadsheetId,
      })
      set({ records: data.records ?? [], recordsLoading: false })
    } catch (error) {
      set({ recordsLoading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  async createTable(projectId, title) {
    try {
      const data = await request<{ spreadsheet: SpreadsheetSummary }>({
        type: 'spreadsheets.create',
        projectId,
        title,
      })
      await get().loadTables(projectId)
      set({ activeTableId: data.spreadsheet?.id ?? null })
      return data.spreadsheet ?? null
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return null
    }
  },

  async removeTable(projectId, spreadsheetId) {
    try {
      await request({ type: 'spreadsheets.delete', projectId, spreadsheetId })
      const tables = get().tables.filter((table) => table.id !== spreadsheetId)
      const activeTableId = get().activeTableId === spreadsheetId ? (tables[0]?.id ?? null) : get().activeTableId
      set({ tables, activeTableId })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  async patchTable(projectId, spreadsheetId, patch) {
    try {
      const data = await request<{ spreadsheet: SpreadsheetSummary | null }>({
        type: 'spreadsheets.patch',
        projectId,
        spreadsheetId,
        ...patch,
      })
      const updated = data.spreadsheet
      if (updated) {
        set({
          tables: get().tables.map((table) => (table.id === spreadsheetId ? { ...table, ...updated } : table)),
        })
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  async createRecord(projectId, spreadsheetId, data) {
    const created = await request<{ record: SpreadsheetRecord }>({
      type: 'spreadsheet.records.create',
      projectId,
      spreadsheetId,
      data,
    })
    if (created.record) {
      set({ records: [...get().records, created.record] })
      set({
        tables: get().tables.map((table) =>
          table.id === spreadsheetId ? { ...table, recordCount: table.recordCount + 1 } : table,
        ),
      })
    }
  },

  async patchRecord(projectId, recordId, data) {
    await request({ type: 'spreadsheet.records.patch', projectId, recordId, data })
    set({
      records: get().records.map((record) =>
        record.id === recordId ? { ...record, data: { ...record.data, ...data } } : record,
      ),
    })
  },

  async removeRecord(projectId, recordId) {
    await request({ type: 'spreadsheet.records.delete', projectId, recordId })
    const target = get().records.find((record) => record.id === recordId)
    set({
      records: get().records.filter((record) => record.id !== recordId),
      tables: get().tables.map((table) =>
        target && table.id === target.spreadsheet_id ? { ...table, recordCount: Math.max(0, table.recordCount - 1) } : table,
      ),
    })
  },

  async reorderRecords(projectId, spreadsheetId, recordIds) {
    const data = await request<{ records: SpreadsheetRecord[] }>({
      type: 'spreadsheet.records.reorder',
      projectId,
      spreadsheetId,
      recordIds,
    })
    set({ records: data.records ?? [] })
  },
}))
