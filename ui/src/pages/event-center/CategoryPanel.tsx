import { Edit3, Plus, Power, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useEventCenterStore, type EventCategoryData } from '../../stores/event-center.store'
import { categoryFields, PRIORITY_META } from './helpers'
import { CategoryCreateModal } from './CategoryCreateModal'

interface Props {
  projectId: string | null
}

export function CategoryPanel({ projectId }: Props) {
  const categories = useEventCenterStore((s) => s.categories)
  const toggleCategory = useEventCenterStore((s) => s.toggleCategory)
  const deleteCategory = useEventCenterStore((s) => s.deleteCategory)
  const [selectedId, setSelectedId] = useState<string | null>(categories[0]?.id ?? null)
  const [editing, setEditing] = useState<EventCategoryData | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const selected = categories.find((category) => category.id === selectedId) ?? categories[0]
  const selectedReadonly = Boolean(projectId && selected?.project_id === null)

  const toggleSelected = async () => {
    if (!selected) return
    setError('')
    if (selectedReadonly) {
      setError('全局类别需要在全局视图编辑')
      return
    }
    await toggleCategory(selected.id, selected.enabled !== 1, projectId ?? undefined)
      .catch((err: unknown) => setError(errorMessage(err, '切换类别状态失败')))
  }

  const deleteSelected = async () => {
    if (!selected) return
    setError('')
    if (selectedReadonly) {
      setError('全局类别需要在全局视图编辑')
      return
    }
    await deleteCategory(selected.id, projectId ?? undefined)
      .catch((err: unknown) => setError(errorMessage(err, '删除类别失败')))
  }

  return (
    <div className="ec-manage">
      <section className="ec-table-pane">
        <div className="ec-list-toolbar ec-list-toolbar--between">
          <div>
            <strong>事件类别</strong>
            <span>管理事件分类和每类事件需要填写的字段。</span>
          </div>
          <button className="ec-btn ec-btn--primary" onClick={() => setCreating(true)}><Plus size={14} />新建类别</button>
        </div>
        <div className="ec-table-scroll">
          <table className="ec-table">
            <thead><tr><th>类别</th><th>字段模板</th><th>默认优先级</th><th>状态</th></tr></thead>
            <tbody>
              {categories.map((category) => <CategoryRow key={category.id} category={category} active={category.id === selected?.id} onClick={() => setSelectedId(category.id)} />)}
              {categories.length === 0 && <tr><td colSpan={4}><div className="ec-empty">暂无事件类别</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="ec-side-panel">
        {selected ? (
          <>
            <div className="ec-detail-head">
              <span className="ec-chip">{scopeLabel(selected)}</span>
              <span className={selected.enabled === 1 ? 'ec-chip ec-chip--green' : 'ec-chip'}>{selected.enabled === 1 ? '启用' : '停用'}</span>
              <h2>{selected.name}</h2>
              <p>{selected.description || '暂无说明'}</p>
            </div>
            <div className="ec-detail-body">
              {error && <div className="ec-form-error">{error}</div>}
              {selectedReadonly && <div className="ec-muted">这是全局类别。当前项目可以直接使用它，编辑或删除需要在全局视图中进行。</div>}
              <section className="ec-section">
                <h3>字段模板</h3>
                <div className="ec-field-list">
                  {categoryFields(selected).map((field) => (
                    <div className="ec-field-card" key={field.key}>
                      <strong>{field.label}</strong>
                      <span>{field.key}{field.required ? ' / 必填' : ''}</span>
                    </div>
                  ))}
                  {categoryFields(selected).length === 0 && <div className="ec-muted">暂无字段模板</div>}
                </div>
              </section>
              <section className="ec-section">
                <h3>处理设置</h3>
                <div className="ec-kv">
                  <div className="ec-kv-row"><span>类别标识</span><b>{selected.id}</b></div>
                  <div className="ec-kv-row"><span>作用域</span><b>{scopeLabel(selected)}</b></div>
                  <div className="ec-kv-row"><span>默认优先级</span><b>{PRIORITY_META[selected.default_priority]?.label ?? selected.default_priority}</b></div>
                </div>
              </section>
            </div>
            <div className="ec-detail-actions">
              <button className="ec-btn" disabled={selectedReadonly} onClick={() => setEditing(selected)} title={selectedReadonly ? '全局类别需要在全局视图编辑' : undefined}><Edit3 size={14} />编辑</button>
              <button className="ec-btn" disabled={selectedReadonly} onClick={toggleSelected} title={selectedReadonly ? '全局类别需要在全局视图编辑' : undefined}><Power size={14} />{selected.enabled === 1 ? '停用' : '启用'}</button>
              <button className="ec-btn ec-btn--danger" disabled={selectedReadonly} onClick={deleteSelected} title={selectedReadonly ? '全局类别需要在全局视图编辑' : undefined}><Trash2 size={14} />删除</button>
            </div>
          </>
        ) : (
          <div className="ec-empty">请选择一个事件类别</div>
        )}
      </aside>
      <CategoryCreateModal open={creating} projectId={projectId} onClose={() => setCreating(false)} />
      <CategoryCreateModal open={Boolean(editing)} projectId={projectId} category={editing ?? undefined} onClose={() => setEditing(null)} />
    </div>
  )
}

function CategoryRow({ category, active, onClick }: { category: EventCategoryData; active: boolean; onClick: () => void }) {
  const fields = categoryFields(category)
  return (
    <tr className={active ? 'active' : ''} onClick={onClick}>
      <td><strong>{category.name}</strong><small>{category.id} / {scopeLabel(category)}</small></td>
      <td>{fields.length} 个字段</td>
      <td>{PRIORITY_META[category.default_priority]?.label ?? category.default_priority}</td>
      <td><span className={category.enabled === 1 ? 'ec-chip ec-chip--green' : 'ec-chip'}>{category.enabled === 1 ? '启用' : '停用'}</span></td>
    </tr>
  )
}

function scopeLabel(category: EventCategoryData): string {
  return category.project_id ? '项目' : '全局'
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}
