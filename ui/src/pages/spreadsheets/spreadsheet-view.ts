import type {
  SpreadsheetField,
  SpreadsheetRecord,
  SpreadsheetSchema,
  SpreadsheetViewConfig,
} from '../../stores/spreadsheet.store'

/** 视图配置聚合出的列定义：colOrder 重排 + hidden 过滤 + colWidths 覆盖宽度 */
export interface GridColumn {
  field: SpreadsheetField
  width: number
  hidden: boolean
}

export const MIN_COL_WIDTH = 70
export const DEFAULT_COL_WIDTH = 130

/** 按 view 配置物化可见列（列序/列宽/隐藏），供表格渲染与拖拽共用的单一事实源 */
export function visibleColumns(schema: SpreadsheetSchema, view: SpreadsheetViewConfig): GridColumn[] {
  const order = view.colOrder ?? schema.fields.map((field) => field.key)
  const byKey = new Map(schema.fields.map((field) => [field.key, field]))
  const columns: GridColumn[] = []
  for (const key of order) {
    const field = byKey.get(key)
    if (!field) continue
    const hidden = (view.hidden ?? []).includes(key)
    columns.push({ field, hidden, width: view.colWidths?.[key] ?? field.w ?? DEFAULT_COL_WIDTH })
  }
  // view.colOrder 里没有的新字段追加在末尾
  for (const field of schema.fields) {
    if (!order.includes(field.key)) {
      columns.push({
        field,
        hidden: (view.hidden ?? []).includes(field.key),
        width: view.colWidths?.[field.key] ?? field.w ?? DEFAULT_COL_WIDTH,
      })
    }
  }
  return columns
}

/** 拖拽列时计算落点在目标的左侧还是右侧 */
export function dropSide(clientX: number, rect: { left: number; width: number }): 'L' | 'R' {
  return clientX < rect.left + rect.width / 2 ? 'L' : 'R'
}

/** 列拖拽重排：把 fromKey 的列移动到 toKey 的 side 侧，返回新 key 顺序 */
export function reorderColumns(
  colOrder: string[],
  fromKey: string,
  toKey: string,
  side: 'L' | 'R',
): string[] {
  if (fromKey === toKey) return colOrder
  const from = colOrder.indexOf(fromKey)
  if (from === -1) return colOrder
  const next = colOrder.filter((key) => key !== fromKey)
  let to = next.indexOf(toKey)
  if (to === -1) return colOrder
  if (side === 'R') to += 1
  next.splice(to, 0, fromKey)
  return next
}

/** 列宽拖拽：最小 70px */
export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_COL_WIDTH
  return Math.max(MIN_COL_WIDTH, Math.round(width))
}

/** 行拖拽重排（本地顺序，落盘走 reorder RPC） */
export function reorderRows<T>(rows: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return rows
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) return rows
  const next = [...rows]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export type CellView =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'tag'; text: string; color: string; fallback: boolean }
  | { kind: 'checkbox'; on: boolean }
  | { kind: 'number'; text: string }

/** 单元格渲染值（5 类型），与原型 renderCell 对齐：未知单选值灰色兜底 */
export function formatCell(field: SpreadsheetField, value: unknown): CellView {
  if (field.type === 'checkbox') {
    return { kind: 'checkbox', on: value === true }
  }
  if (value === undefined || value === null || value === '') {
    return { kind: 'empty' }
  }
  if (field.type === 'singleSelect') {
    const text = String(value)
    const option = field.options?.find((item) => item.n === text)
    return { kind: 'tag', text, color: option?.c ?? 'gray', fallback: !option }
  }
  if (field.type === 'number') {
    return { kind: 'number', text: String(value) }
  }
  return { kind: 'text', text: String(value) }
}

/** view.sort 应用到本地行序（行数据排序，不改变 sort 落盘序） */
export function sortRecords(records: SpreadsheetRecord[], sort?: { key: string; dir: 1 | -1 }): SpreadsheetRecord[] {
  if (!sort?.key) return records
  const dir = sort.dir ?? 1
  return [...records].sort((a, b) => {
    const av = a.data[sort.key]
    const bv = b.data[sort.key]
    if (av === bv) return 0
    if (av === undefined || av === null || av === '') return 1
    if (bv === undefined || bv === null || bv === '') return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av).localeCompare(String(bv), 'zh-Hans-CN') * dir
  })
}

/** 单选标签自动配色（与 server 端 OPTION_PALETTE 顺序一致） */
export const OPTION_PALETTE = ['blue', 'green', 'purple', 'orange', 'red', 'yellow', 'gray']

export function nextOptionColor(index: number): string {
  return OPTION_PALETTE[index % OPTION_PALETTE.length]
}
