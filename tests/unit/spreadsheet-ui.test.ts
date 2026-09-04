import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { SpreadsheetGrid } from '../../ui/src/pages/spreadsheets/SpreadsheetGrid.js'
import { TablesPane } from '../../ui/src/pages/spreadsheets/SpreadsheetsPage.js'
import { FieldManagerModal } from '../../ui/src/pages/spreadsheets/FieldManagerModal.js'
import { NewTableModal } from '../../ui/src/pages/spreadsheets/NewTableModal.js'
import {
  clampWidth,
  dropSide,
  formatCell,
  nextOptionColor,
  reorderColumns,
  reorderRows,
  sortRecords,
  visibleColumns,
} from '../../ui/src/pages/spreadsheets/spreadsheet-view.js'
import type {
  SpreadsheetField,
  SpreadsheetRecord,
  SpreadsheetSummary,
} from '../../ui/src/stores/spreadsheet.store.js'

const SCHEMA_FIELDS: SpreadsheetField[] = [
  { key: 'title', name: '标题', type: 'text', w: 200 },
  { key: 'status', name: '状态', type: 'singleSelect', w: 110, options: [{ n: '待处理', c: 'red' }, { n: '进行中', c: 'blue' }] },
  { key: 'due', name: '日期', type: 'date', w: 120 },
  { key: 'score', name: '分数', type: 'number', w: 90 },
  { key: 'done', name: '完成', type: 'checkbox', w: 80 },
]

function tableFixture(overrides: Partial<SpreadsheetSummary> = {}): SpreadsheetSummary {
  return {
    id: 'sheet-1',
    project_id: 'proj-1',
    name: 'tbl-buglist',
    title: 'bug 清单',
    schema_json: JSON.stringify({ fields: SCHEMA_FIELDS }),
    view_json: '{}',
    created_at: '2026-09-04T00:00:00.000Z',
    updated_at: '2026-09-04T00:00:00.000Z',
    schema: { fields: SCHEMA_FIELDS },
    view: {},
    recordCount: 2,
    ...overrides,
  }
}

function recordFixture(id: string, data: Record<string, unknown>, overrides: Partial<SpreadsheetRecord> = {}): SpreadsheetRecord {
  return {
    id,
    spreadsheet_id: 'sheet-1',
    data_json: JSON.stringify(data),
    sort: 0,
    created_by: 'user',
    created_at: '2026-09-04T00:00:00.000Z',
    updated_at: '2026-09-04T00:00:00.000Z',
    data,
    ...overrides,
  }
}

const noop = () => {}

function gridProps(overrides: Record<string, unknown> = {}) {
  return {
    table: tableFixture(),
    records: [
      recordFixture('rec-1', { title: '登录崩溃', status: '待处理', due: '2026-09-05', score: 3, done: true }),
      recordFixture('rec-2', { title: '支付超时', status: '未知旧值' }),
    ],
    recordsLoading: false,
    onSaveCell: noop,
    onReorderRows: noop,
    onPatchView: noop,
    onDeleteRow: noop,
    onAddRow: noop,
    onOpenFieldManager: noop,
    ...overrides,
  }
}

describe('spreadsheet view helpers（渲染/拖拽/视图配置纯函数）', () => {
  test('formatCell renders the 5 field types with empty and fallback branches', () => {
    const fields = SCHEMA_FIELDS
    // text
    expect(formatCell(fields[0], '登录崩溃')).toEqual({ kind: 'text', text: '登录崩溃' })
    // singleSelect：合法选项
    expect(formatCell(fields[1], '待处理')).toEqual({ kind: 'tag', text: '待处理', color: 'red', fallback: false })
    // singleSelect：不在 options → 灰色兜底
    expect(formatCell(fields[1], '未知旧值')).toEqual({ kind: 'tag', text: '未知旧值', color: 'gray', fallback: true })
    // date
    expect(formatCell(fields[2], '2026-09-05')).toEqual({ kind: 'text', text: '2026-09-05' })
    // number
    expect(formatCell(fields[3], 3)).toEqual({ kind: 'number', text: '3' })
    // checkbox
    expect(formatCell(fields[4], true)).toEqual({ kind: 'checkbox', on: true })
    expect(formatCell(fields[4], false)).toEqual({ kind: 'checkbox', on: false })
    // 空值
    expect(formatCell(fields[0], null)).toEqual({ kind: 'empty' })
    expect(formatCell(fields[0], '')).toEqual({ kind: 'empty' })
    expect(formatCell(fields[2], undefined)).toEqual({ kind: 'empty' })
  })

  test('visibleColumns applies colOrder, hidden and colWidths; new fields appended', () => {
    const schema = { fields: SCHEMA_FIELDS }
    const view = { colOrder: ['status', 'title', 'due'], colWidths: { title: 333 }, hidden: ['due'] }
    const columns = visibleColumns(schema, view)
    expect(columns.map((column) => column.field.key)).toEqual(['status', 'title', 'due', 'score', 'done'])
    expect(columns.find((column) => column.field.key === 'title')?.width).toBe(333)
    expect(columns.find((column) => column.field.key === 'due')?.hidden).toBe(true)
    expect(columns.find((column) => column.field.key === 'status')?.width).toBe(110)
  })

  test('column drag: dropSide + reorderColumns insert left/right', () => {
    expect(dropSide(10, { left: 0, width: 100 })).toBe('L')
    expect(dropSide(90, { left: 0, width: 100 })).toBe('R')

    const order = ['a', 'b', 'c', 'd']
    expect(reorderColumns(order, 'a', 'c', 'L')).toEqual(['b', 'a', 'c', 'd'])
    expect(reorderColumns(order, 'a', 'c', 'R')).toEqual(['b', 'c', 'a', 'd'])
    expect(reorderColumns(order, 'a', 'a', 'L')).toEqual(order)
    expect(reorderColumns(order, 'x', 'a', 'L')).toEqual(order)
  })

  test('column width drag clamps to minimum 70px', () => {
    expect(clampWidth(150)).toBe(150)
    expect(clampWidth(20)).toBe(70)
    expect(clampWidth(-5)).toBe(70)
    expect(clampWidth(Number.NaN)).toBe(70)
  })

  test('row drag reorder moves rows and rejects out-of-range indexes', () => {
    const rows = ['r1', 'r2', 'r3']
    expect(reorderRows(rows, 0, 2)).toEqual(['r2', 'r3', 'r1'])
    expect(reorderRows(rows, 2, 0)).toEqual(['r3', 'r1', 'r2'])
    expect(reorderRows(rows, 1, 1)).toEqual(rows)
    expect(reorderRows(rows, -1, 2)).toEqual(rows)
    expect(reorderRows(rows, 0, 9)).toEqual(rows)
  })

  test('sortRecords orders by view sort with empty values last', () => {
    const records = [
      recordFixture('a', { score: 3 }),
      recordFixture('b', { score: 10 }),
      recordFixture('c', {}),
      recordFixture('d', { score: 1 }),
    ]
    const asc = sortRecords(records, { key: 'score', dir: 1 })
    expect(asc.map((record) => record.id)).toEqual(['d', 'a', 'b', 'c'])
    const desc = sortRecords(records, { key: 'score', dir: -1 })
    expect(desc.map((record) => record.id)).toEqual(['b', 'a', 'd', 'c'])
    expect(sortRecords(records, undefined)).toEqual(records)
  })

  test('nextOptionColor cycles the shared palette', () => {
    expect(nextOptionColor(0)).toBe('blue')
    expect(nextOptionColor(6)).toBe('gray')
    expect(nextOptionColor(7)).toBe('blue')
  })
})

describe('SpreadsheetGrid（静态渲染）', () => {
  test('renders 5 field types in cells: tag, checkbox, date, number, text', () => {
    const html = renderToStaticMarkup(createElement(SpreadsheetGrid, gridProps() as never))
    expect(html).toContain('spx-tag')
    expect(html).toContain('c-red')
    expect(html).toContain('spx-cb on')
    expect(html).toContain('2026-09-05')
    expect(html).toContain('spx-num')
    expect(html).toContain('登录崩溃')
    // 未知单选值灰色兜底
    expect(html).toContain('spx-tag--fallback')
    // 空值渲染 —
    expect(html).toContain('spx-empty')
    // 表头 5 列 + 行号列
    expect(html).toContain('data-key="title"')
    expect(html).toContain('data-key="status"')
    expect(html).toContain('data-key="due"')
    expect(html).toContain('data-key="score"')
    expect(html).toContain('data-key="done"')
    expect(html).toContain('spx-th-rownum')
  })

  test('renders sort indicator and applies view config to widths', () => {
    const view = { colWidths: { title: 320 }, sort: { key: 'score', dir: 1 as const } }
    const html = renderToStaticMarkup(
      createElement(SpreadsheetGrid, gridProps({ table: tableFixture({ view }) }) as never),
    )
    expect(html).toContain('width:320px')
    expect(html).toContain('↑')
  })

  test('empty table shows empty state with add-row button', () => {
    const html = renderToStaticMarkup(createElement(SpreadsheetGrid, gridProps({ records: [] }) as never))
    expect(html).toContain('还没有记录')
    expect(html).toContain('新增第一行')
  })

  test('loading state renders instead of the table', () => {
    const html = renderToStaticMarkup(createElement(SpreadsheetGrid, gridProps({ recordsLoading: true }) as never))
    expect(html).toContain('加载记录中')
  })
})

describe('TablesPane 四分支', () => {
  const base = {
    projects: [{ id: 'proj-1', name: '演示项目' }],
    selectedProjectId: 'proj-1',
    onSelectProject: noop,
    tables: [tableFixture()],
    activeTableId: 'sheet-1',
    loading: false,
    error: null,
    noProjectBound: false,
    searchText: '',
    onSearchText: noop,
    onSelectTable: noop,
    onNewTable: noop,
  }

  test('data branch: renders table cards with title/name/count', () => {
    const html = renderToStaticMarkup(createElement(TablesPane, base as never))
    expect(html).toContain('bug 清单')
    expect(html).toContain('tbl-buglist')
    expect(html).toContain('2 条')
    expect(html).toContain('spx-card on')
  })

  test('no project bound branch', () => {
    const html = renderToStaticMarkup(createElement(TablesPane, { ...base, noProjectBound: true } as never))
    expect(html).toContain('请先在顶部选择一个项目')
  })

  test('loading branch', () => {
    const html = renderToStaticMarkup(createElement(TablesPane, { ...base, loading: true } as never))
    expect(html).toContain('加载表格中')
  })

  test('error branch shows message with retry', () => {
    const html = renderToStaticMarkup(
      createElement(TablesPane, { ...base, error: '连接已断开' } as never),
    )
    expect(html).toContain('连接已断开')
    expect(html).toContain('重试')
  })

  test('empty branch: no tables and no search match', () => {
    const empty = renderToStaticMarkup(createElement(TablesPane, { ...base, tables: [] } as never))
    expect(empty).toContain('这个项目还没有表格')
    const noMatch = renderToStaticMarkup(createElement(TablesPane, { ...base, searchText: '不存在的表' } as never))
    expect(noMatch).toContain('没有匹配的表格')
  })

  test('search filters cards by title', () => {
    const tables = [tableFixture(), tableFixture({ id: 'sheet-2', title: '需求排期' })]
    const html = renderToStaticMarkup(
      createElement(TablesPane, { ...base, tables, searchText: '需求' } as never),
    )
    expect(html).toContain('需求排期')
    expect(html).not.toContain('bug 清单')
  })
})

describe('弹窗（静态渲染）', () => {
  test('FieldManagerModal renders fields with type grid, options and visibility toggles', () => {
    const html = renderToStaticMarkup(
      createElement(FieldManagerModal, {
        schema: { fields: SCHEMA_FIELDS },
        view: {},
        onClose: noop,
        onApply: noop,
      }),
    )
    expect(html).toContain('字段管理')
    expect(html).toContain('标题')
    expect(html).toContain('待处理') // 单选选项
    expect(html).not.toContain('spx-addfield-actions') // 默认不在添加态
  })

  test('NewTableModal renders title input and hint about default 3 fields', () => {
    const html = renderToStaticMarkup(createElement(NewTableModal, { onClose: noop, onCreate: noop }))
    expect(html).toContain('新建表格')
    expect(html).toContain('3 个字段')
  })
})
