import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { SpreadsheetField, SpreadsheetRecord, SpreadsheetSummary, SpreadsheetViewConfig } from '../../stores/spreadsheet.store'
import {
  clampWidth,
  dropSide,
  formatCell,
  reorderColumns,
  reorderRows,
  sortRecords,
  visibleColumns,
  type GridColumn,
} from './spreadsheet-view'

const TYPE_BADGE: Record<string, string> = {
  text: 'T',
  number: '#',
  singleSelect: 'S',
  date: 'D',
  checkbox: 'C',
}

interface SpreadsheetGridProps {
  table: SpreadsheetSummary
  records: SpreadsheetRecord[]
  recordsLoading: boolean
  onSaveCell: (recordId: string, key: string, value: unknown) => void
  onReorderRows: (recordIds: string[]) => void
  onPatchView: (view: SpreadsheetViewConfig) => void
  onDeleteRow: (recordId: string) => void
  onAddRow: () => void
  onOpenFieldManager: () => void
}

interface EditingCell {
  recordId: string
  key: string
  initial: string
}

interface ColumnDrag {
  fromKey: string
  overKey: string | null
  side: 'L' | 'R'
  moved: boolean
}

interface RowDrag {
  fromIndex: number
  overIndex: number | null
  moved: boolean
}

interface WidthDrag {
  key: string
  startX: number
  startWidth: number
}

export function SpreadsheetGrid(props: SpreadsheetGridProps) {
  const { table, records, recordsLoading } = props
  const view = table.view ?? {}
  const columns = visibleColumns(table.schema, view)
  const shownColumns = columns.filter((column) => !column.hidden)

  const [editing, setEditing] = useState<EditingCell | null>(null)
  const [colDrag, setColDrag] = useState<ColumnDrag | null>(null)
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null)
  const [widthDrag, setWidthDrag] = useState<WidthDrag | null>(null)
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({})
  const editInputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)
  const cancelRef = useRef(false)

  // 单选/日期：单击即编辑并直接展开下拉/日历，不再二次点击
  useEffect(() => {
    if (!editing) return
    const node = editInputRef.current
    if (node) {
      node.focus()
      if (node instanceof HTMLInputElement && node.select) node.select()
      const picker = (node as HTMLInputElement & { showPicker?: () => void }).showPicker
      if (typeof picker === 'function') {
        try {
          picker.call(node)
        } catch {
          // 浏览器可能拒绝非用户手势的 showPicker，忽略
        }
      }
    }
  }, [editing])

  // 列宽拖拽：pointermove 全局监听，实时跟手
  useEffect(() => {
    if (!widthDrag) return
    const onMove = (event: PointerEvent) => {
      const width = clampWidth(widthDrag.startWidth + event.clientX - widthDrag.startX)
      setLiveWidths((prev) => ({ ...prev, [widthDrag.key]: width }))
    }
    const onUp = () => {
      setLiveWidths((prev) => {
        const width = prev[widthDrag.key]
        if (width !== undefined) {
          props.onPatchView({ ...view, colWidths: { ...(view.colWidths ?? {}), [widthDrag.key]: width } })
        }
        return prev
      })
      setWidthDrag(null)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthDrag])

  const orderedRecords = sortRecords(records, view.sort)

  function columnWidth(column: GridColumn): number {
    return liveWidths[column.field.key] ?? column.width
  }

  function startColumnDrag(event: React.PointerEvent, key: string) {
    if (event.button !== 0) return
    setColDrag({ fromKey: key, overKey: null, side: 'L', moved: false })
  }

  function columnDragOver(event: React.PointerEvent, key: string) {
    if (!colDrag || colDrag.fromKey === key) return
    const rect = event.currentTarget.getBoundingClientRect()
    setColDrag((prev) => (prev ? { ...prev, overKey: key, side: dropSide(event.clientX, rect), moved: true } : prev))
  }

  function endColumnDrag() {
    if (colDrag?.moved && colDrag.overKey && colDrag.overKey !== colDrag.fromKey) {
      const currentOrder = view.colOrder ?? table.schema.fields.map((field) => field.key)
      const nextOrder = reorderColumns(currentOrder, colDrag.fromKey, colDrag.overKey, colDrag.side)
      if (nextOrder !== currentOrder) {
        props.onPatchView({ ...view, colOrder: nextOrder })
      }
    }
    setColDrag(null)
  }

  function startRowDrag(event: React.PointerEvent, index: number) {
    if (event.button !== 0) return
    setRowDrag({ fromIndex: index, overIndex: null, moved: false })
  }

  function rowDragOver(index: number) {
    setRowDrag((prev) => (prev && prev.fromIndex !== index ? { ...prev, overIndex: index, moved: true } : prev))
  }

  function endRowDrag() {
    if (rowDrag?.moved && rowDrag.overIndex !== null && rowDrag.overIndex !== rowDrag.fromIndex) {
      const next = reorderRows(orderedRecords, rowDrag.fromIndex, rowDrag.overIndex)
      props.onReorderRows(next.map((record) => record.id))
    }
    setRowDrag(null)
  }

  function startWidthDrag(event: React.PointerEvent, key: string, width: number) {
    event.stopPropagation()
    event.preventDefault()
    setWidthDrag({ key, startX: event.clientX, startWidth: width })
  }

  function headerClick(field: SpreadsheetField) {
    if (colDrag?.moved) return
    const sort = view.sort
    const next: SpreadsheetViewConfig['sort'] =
      sort?.key === field.key ? { key: field.key, dir: sort.dir === 1 ? -1 : 1 } : { key: field.key, dir: 1 }
    props.onPatchView({ ...view, sort: next })
  }

  function startEdit(record: SpreadsheetRecord, field: SpreadsheetField) {
    if (field.type === 'checkbox') return // 勾选框直点切换，无编辑态
    cancelRef.current = false
    setEditing({ recordId: record.id, key: field.key, initial: String(record.data[field.key] ?? '') })
  }

  function commitEdit(value: string) {
    if (!editing) return
    const field = table.schema.fields.find((item) => item.key === editing.key)
    const { recordId, key, initial } = editing
    setEditing(null)
    if (cancelRef.current) return
    let next: unknown = value
    if (field?.type === 'number') next = value === '' ? null : Number(value)
    if ((field?.type === 'singleSelect' || field?.type === 'date') && value === '') next = null
    if (String(initial) === String(next ?? '')) return
    props.onSaveCell(recordId, key, next)
  }

  function renderCellContent(record: SpreadsheetRecord, column: GridColumn) {
    const { field } = column
    const cell = formatCell(field, record.data[field.key])
    if (editing && editing.recordId === record.id && editing.key === field.key) {
      return renderEditControl(field)
    }
    if (cell.kind === 'tag') {
      return <span className={`spx-tag c-${cell.color}${cell.fallback ? ' spx-tag--fallback' : ''}`}>{cell.text}</span>
    }
    if (cell.kind === 'checkbox') {
      return (
        <span
          className={`spx-cb${cell.on ? ' on' : ''}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            props.onSaveCell(record.id, field.key, !cell.on)
          }}
          role="checkbox"
          aria-checked={cell.on}
        >
          {cell.on ? '✓' : ''}
        </span>
      )
    }
    if (cell.kind === 'empty') return <span className="spx-empty">—</span>
    if (cell.kind === 'number') return <span className="spx-num">{cell.text}</span>
    return <span className="spx-text">{cell.text}</span>
  }

  function renderEditControl(field: SpreadsheetField) {
    const value = editing?.initial ?? ''
    if (field.type === 'singleSelect') {
      return (
        <select
          ref={editInputRef as React.RefObject<HTMLSelectElement>}
          className="spx-edit"
          defaultValue={value}
          onChange={(event) => commitEdit(event.target.value)}
          onBlur={() => commitEdit(editing?.initial ?? '')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              cancelRef.current = true
              setEditing(null)
            }
          }}
        >
          <option value="">—</option>
          {(field.options ?? []).map((option) => (
            <option key={option.n} value={option.n}>
              {option.n}
            </option>
          ))}
        </select>
      )
    }
    if (field.type === 'date') {
      return (
        <input
          ref={editInputRef as React.RefObject<HTMLInputElement>}
          className="spx-edit"
          type="date"
          defaultValue={value}
          onChange={(event) => commitEdit(event.target.value)}
          onBlur={(event) => commitEdit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              cancelRef.current = true
              setEditing(null)
            }
          }}
        />
      )
    }
    return (
      <input
        ref={editInputRef as React.RefObject<HTMLInputElement>}
        className="spx-edit"
        type={field.type === 'number' ? 'number' : 'text'}
        defaultValue={value}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitEdit((event.target as HTMLInputElement).value)
          if (event.key === 'Escape') {
            cancelRef.current = true
            setEditing(null)
          }
        }}
        onBlur={(event) => commitEdit(event.target.value)}
      />
    )
  }

  return (
    <div className="spx-grid-wrap">
      <div className="spx-grid-head">
        <div className="spx-grid-title">
          <strong>{table.title}</strong>
          <span className="spx-grid-name">{table.name}</span>
          <span className="spx-grid-count">{records.length} 条记录</span>
        </div>
        <div className="spx-grid-actions">
          <button type="button" className="spx-btn spx-btn--ghost" onClick={props.onOpenFieldManager}>
            字段管理
          </button>
          <button type="button" className="spx-btn spx-btn--primary" onClick={props.onAddRow}>
            <Plus size={14} /> 新增行
          </button>
        </div>
      </div>
      {recordsLoading ? (
        <div className="spx-state">加载记录中…</div>
      ) : orderedRecords.length === 0 ? (
        <div className="spx-state">
          <p>这张表还没有记录</p>
          <button type="button" className="spx-btn spx-btn--primary" onClick={props.onAddRow}>
            <Plus size={14} /> 新增第一行
          </button>
        </div>
      ) : (
        <div className="spx-grid-scroll">
          <table className="spx-table">
            <thead>
              <tr>
                <th className="spx-th-rownum" style={{ width: 44 }}>
                  #
                </th>
                {shownColumns.map((column) => {
                  const isOver = colDrag?.moved && colDrag.overKey === column.field.key
                  const side = colDrag?.side
                  return (
                    <th
                      key={column.field.key}
                      data-key={column.field.key}
                      className={`spx-th${isOver ? (side === 'L' ? ' drop-l' : ' drop-r') : ''}`}
                      style={{ width: columnWidth(column), minWidth: columnWidth(column) }}
                      onPointerDown={(event) => startColumnDrag(event, column.field.key)}
                      onPointerMove={(event) => columnDragOver(event, column.field.key)}
                      onPointerUp={endColumnDrag}
                    >
                      <div className="spx-th-in" onClick={() => headerClick(column.field)}>
                        <span className="spx-ftype">{TYPE_BADGE[column.field.type] ?? '?'}</span>
                        <span className="spx-th-name" title={`${column.field.name}（点击排序）`}>
                          {column.field.name}
                          {view.sort?.key === column.field.key ? (view.sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                        </span>
                      </div>
                      <span
                        className="spx-resize"
                        onPointerDown={(event) => startWidthDrag(event, column.field.key, columnWidth(column))}
                      />
                    </th>
                  )
                })}
                <th className="spx-th-op" style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {orderedRecords.map((record, index) => (
                <tr
                  key={record.id}
                  className={`spx-tr${rowDrag?.moved && rowDrag.overIndex === index ? ' drop-target' : ''}`}
                  onPointerMove={() => rowDragOver(index)}
                  onPointerUp={endRowDrag}
                >
                  <td
                    className="spx-td-rownum"
                    onPointerDown={(event) => startRowDrag(event, index)}
                    title="拖动调整行序"
                  >
                    {index + 1}
                  </td>
                  {shownColumns.map((column) => (
                    <td
                      key={column.field.key}
                      className="spx-td"
                      style={{ maxWidth: columnWidth(column) }}
                      onClick={() => startEdit(record, column.field)}
                    >
                      {renderCellContent(record, column)}
                    </td>
                  ))}
                  <td className="spx-td-op">
                    <button
                      type="button"
                      className="spx-row-del"
                      title="删除该行"
                      onClick={() => props.onDeleteRow(record.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
