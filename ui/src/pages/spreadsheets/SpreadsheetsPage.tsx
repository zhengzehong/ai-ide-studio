import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Sheet } from 'lucide-react'
import { useProjectStore } from '../../stores/project.store'
import {
  useSpreadsheetStore,
  type SpreadsheetRecord,
  type SpreadsheetSchema,
  type SpreadsheetSummary,
  type SpreadsheetViewConfig,
} from '../../stores/spreadsheet.store'
import { SpreadsheetGrid } from './SpreadsheetGrid'
import { FieldManagerModal } from './FieldManagerModal'
import { NewTableModal } from './NewTableModal'
import './spreadsheets.css'

interface TablesPaneProps {
  projects: Array<{ id: string; name: string }>
  selectedProjectId: string | null
  onSelectProject: (projectId: string) => void
  tables: SpreadsheetSummary[]
  activeTableId: string | null
  loading: boolean
  error: string | null
  noProjectBound: boolean
  searchText: string
  onSearchText: (text: string) => void
  onSelectTable: (spreadsheetId: string) => void
  onNewTable: () => void
}

/** 左侧表格卡片列表：四分支（无项目 / loading / error / 数据），含搜索与项目筛选 */
export function TablesPane(props: TablesPaneProps) {
  const filtered = useMemo(
    () => props.tables.filter((table) => table.title.toLowerCase().includes(props.searchText.trim().toLowerCase())),
    [props.tables, props.searchText],
  )

  return (
    <aside className="spx-side">
      <div className="spx-side-head">
        <div className="spx-side-title">表格</div>
        <button type="button" className="spx-btn spx-btn--primary" onClick={props.onNewTable}>
          <Plus size={14} /> 新建表格
        </button>
      </div>
      {props.projects.length > 1 && (
        <select
          className="spx-project-select"
          value={props.selectedProjectId ?? ''}
          onChange={(event) => props.onSelectProject(event.target.value)}
        >
          {props.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      )}
      <div className="spx-search">
        <Search size={13} />
        <input
          placeholder="搜索表格…"
          value={props.searchText}
          onChange={(event) => props.onSearchText(event.target.value)}
        />
      </div>
      <div className="spx-cards">
        {props.noProjectBound ? (
          <div className="spx-state spx-state--pane">请先在顶部选择一个项目</div>
        ) : props.loading ? (
          <div className="spx-state spx-state--pane">加载表格中…</div>
        ) : props.error ? (
          <div className="spx-state spx-state--pane spx-state--error">
            <p>{props.error}</p>
            <button type="button" className="spx-btn spx-btn--ghost" onClick={() => props.selectedProjectId && props.onSelectProject(props.selectedProjectId)}>
              重试
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="spx-state spx-state--pane">
            <p>{props.searchText ? '没有匹配的表格' : '这个项目还没有表格'}</p>
          </div>
        ) : (
          filtered.map((table) => (
            <button
              key={table.id}
              type="button"
              className={`spx-card${table.id === props.activeTableId ? ' on' : ''}`}
              onClick={() => props.onSelectTable(table.id)}
            >
              <Sheet size={15} className="spx-card-icon" />
              <div className="spx-card-main">
                <div className="spx-card-title">{table.title}</div>
                <div className="spx-card-meta">
                  {table.name} · {table.recordCount} 条
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}

export function SpreadsheetsPage() {
  const projects = useProjectStore((state) => state.projects)
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const fetchProjects = useProjectStore((state) => state.fetchProjects)

  const tables = useSpreadsheetStore((state) => state.tables)
  const records = useSpreadsheetStore((state) => state.records)
  const activeTableId = useSpreadsheetStore((state) => state.activeTableId)
  const loading = useSpreadsheetStore((state) => state.loading)
  const recordsLoading = useSpreadsheetStore((state) => state.recordsLoading)
  const error = useSpreadsheetStore((state) => state.error)
  const loadTables = useSpreadsheetStore((state) => state.loadTables)
  const loadRecords = useSpreadsheetStore((state) => state.loadRecords)
  const selectTable = useSpreadsheetStore((state) => state.selectTable)
  const createTable = useSpreadsheetStore((state) => state.createTable)
  const removeTable = useSpreadsheetStore((state) => state.removeTable)
  const patchTable = useSpreadsheetStore((state) => state.patchTable)
  const createRecord = useSpreadsheetStore((state) => state.createRecord)
  const patchRecord = useSpreadsheetStore((state) => state.patchRecord)
  const removeRecord = useSpreadsheetStore((state) => state.removeRecord)
  const reorderRecords = useSpreadsheetStore((state) => state.reorderRecords)

  const [projectFilter, setProjectFilter] = useState<string | null>(currentProjectId)
  const [searchText, setSearchText] = useState('')
  const [showNewTable, setShowNewTable] = useState(false)
  const [showFieldManager, setShowFieldManager] = useState(false)
  const [tableError, setTableError] = useState<string | null>(null)

  useEffect(() => {
    if (!projects.length) void fetchProjects()
  }, [projects.length, fetchProjects])

  const effectiveProjectId = projectFilter ?? currentProjectId

  useEffect(() => {
    if (effectiveProjectId) void loadTables(effectiveProjectId)
  }, [effectiveProjectId, loadTables])

  const activeTable = tables.find((table) => table.id === activeTableId) ?? null
  const activeId = activeTable?.id ?? null

  useEffect(() => {
    if (effectiveProjectId && activeId) void loadRecords(effectiveProjectId, activeId)
  }, [effectiveProjectId, activeId, loadRecords])

  async function handleSaveCell(recordId: string, key: string, value: unknown) {
    if (!effectiveProjectId) return
    try {
      setTableError(null)
      await patchRecord(effectiveProjectId, recordId, { [key]: value })
    } catch (err) {
      setTableError(err instanceof Error ? err.message : String(err))
    }
  }

  function handlePatchView(view: SpreadsheetViewConfig) {
    if (!effectiveProjectId || !activeTable) return
    void patchTable(effectiveProjectId, activeTable.id, { view })
  }

  async function handleAddRow() {
    if (!effectiveProjectId || !activeTable) return
    try {
      setTableError(null)
      await createRecord(effectiveProjectId, activeTable.id, {})
    } catch (err) {
      setTableError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleReorderRows(recordIds: string[]) {
    if (!effectiveProjectId || !activeTable) return
    try {
      await reorderRecords(effectiveProjectId, activeTable.id, recordIds)
    } catch (err) {
      setTableError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDeleteRow(recordId: string) {
    if (!effectiveProjectId) return
    try {
      await removeRecord(effectiveProjectId, recordId)
    } catch (err) {
      setTableError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleApplyFields(schema: SpreadsheetSchema, view: SpreadsheetViewConfig) {
    if (!effectiveProjectId || !activeTable) return
    void patchTable(effectiveProjectId, activeTable.id, { schema, view })
    setShowFieldManager(false)
  }

  async function handleCreateTable(title: string) {
    if (!effectiveProjectId) return
    setShowNewTable(false)
    await createTable(effectiveProjectId, title)
  }

  async function handleDeleteTable() {
    if (!effectiveProjectId || !activeTable) return
    await removeTable(effectiveProjectId, activeTable.id)
  }

  return (
    <div className="spx-page">
      <TablesPane
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        selectedProjectId={effectiveProjectId}
        onSelectProject={(projectId) => setProjectFilter(projectId)}
        tables={tables}
        activeTableId={activeTableId}
        loading={loading}
        error={error}
        noProjectBound={!effectiveProjectId}
        searchText={searchText}
        onSearchText={setSearchText}
        onSelectTable={(spreadsheetId) => selectTable(spreadsheetId)}
        onNewTable={() => setShowNewTable(true)}
      />
      <main className="spx-main">
        {tableError && <div className="spx-banner spx-banner--error">{tableError}</div>}
        {activeTable ? (
          <SpreadsheetGrid
            table={activeTable}
            records={records as SpreadsheetRecord[]}
            recordsLoading={recordsLoading}
            onSaveCell={handleSaveCell}
            onReorderRows={handleReorderRows}
            onPatchView={handlePatchView}
            onDeleteRow={handleDeleteRow}
            onAddRow={handleAddRow}
            onOpenFieldManager={() => setShowFieldManager(true)}
          />
        ) : (
          <div className="spx-state spx-state--main">
            {loading ? (
              <p>加载中…</p>
            ) : (
              <>
                <p>选择左侧表格，或新建一张</p>
                <button type="button" className="spx-btn spx-btn--primary" onClick={() => setShowNewTable(true)}>
                  <Plus size={14} /> 新建表格
                </button>
              </>
            )}
          </div>
        )}
        {activeTable && (
          <div className="spx-danger-zone">
            <button type="button" className="spx-btn spx-btn--danger" onClick={handleDeleteTable}>
              删除这张表
            </button>
            <span className="spx-hint">删除表会同时删除其中所有记录，不可恢复</span>
          </div>
        )}
      </main>
      {showNewTable && <NewTableModal onClose={() => setShowNewTable(false)} onCreate={handleCreateTable} />}
      {showFieldManager && activeTable && (
        <FieldManagerModal
          schema={activeTable.schema}
          view={activeTable.view ?? {}}
          onClose={() => setShowFieldManager(false)}
          onApply={handleApplyFields}
        />
      )}
    </div>
  )
}

export default SpreadsheetsPage
