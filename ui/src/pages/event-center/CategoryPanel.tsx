import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useEventCenterStore, type EventCategoryData } from '../../stores/event-center.store'
import { parseJson } from './helpers'

export function CategoryPanel() {
  const categories = useEventCenterStore((s) => s.categories)
  const createCategory = useEventCenterStore((s) => s.createCategory)
  const [selectedId, setSelectedId] = useState<string | null>(categories[0]?.id ?? null)
  const [name, setName] = useState('')
  const selected = categories.find((category) => category.id === selectedId) ?? categories[0]

  const fields = useMemo(() => {
    const schema = parseJson<{ properties?: Record<string, unknown> }>(selected?.schema_json, {})
    return Object.keys(schema.properties ?? {})
  }, [selected?.schema_json])

  const addCategory = async () => {
    if (!name.trim()) return
    const id = name.trim().toLowerCase().replace(/\s+/g, '.')
    const category = await createCategory({
      categoryId: id,
      name: name.trim(),
      description: '自定义事件类别',
      schema: { type: 'object', properties: { title: { type: 'string' } } },
    })
    setSelectedId(category.id)
    setName('')
  }

  return (
    <div className="ec-manage">
      <section className="ec-table-pane">
        <div className="ec-list-toolbar">
          <input className="ec-inline-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="新类别名称，例如 AI 趋势" />
          <button className="ec-btn ec-btn--primary" onClick={addCategory}><Plus size={14} />新建类别</button>
        </div>
        <div className="ec-table-scroll">
          <table className="ec-table">
            <thead><tr><th>类别</th><th>字段模板</th><th>状态</th></tr></thead>
            <tbody>
              {categories.map((category) => <CategoryRow key={category.id} category={category} active={category.id === selected?.id} onClick={() => setSelectedId(category.id)} />)}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="ec-side-panel">
        {selected && (
          <>
            <div className="ec-detail-head">
              <span className="ec-chip ec-chip--blue">{selected.id}</span>
              <h2>{selected.name}</h2>
              <p>{selected.description || '暂无描述'}</p>
            </div>
            <div className="ec-detail-body">
              <section className="ec-section"><h3>字段模板</h3><div className="ec-chip-list">{fields.map((field) => <span className="ec-chip" key={field}>{field}</span>)}</div></section>
              <section className="ec-section"><h3>权限</h3><PermissionChips title="允许写入" value={selected.allowed_writers_json} /><PermissionChips title="允许消费" value={selected.allowed_consumers_json} /></section>
              <section className="ec-section"><h3>schema_json</h3><pre className="ec-code">{JSON.stringify(parseJson(selected.schema_json, {}), null, 2)}</pre></section>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

function CategoryRow({ category, active, onClick }: { category: EventCategoryData; active: boolean; onClick: () => void }) {
  const schema = parseJson<{ properties?: Record<string, unknown> }>(category.schema_json, {})
  return (
    <tr className={active ? 'active' : ''} onClick={onClick}>
      <td><strong>{category.name}</strong><small>{category.id}</small></td>
      <td>{Object.keys(schema.properties ?? {}).length} 个字段</td>
      <td><span className={category.enabled ? 'ec-chip ec-chip--green' : 'ec-chip'}>{category.enabled ? '启用' : '停用'}</span></td>
    </tr>
  )
}

function PermissionChips({ title, value }: { title: string; value: string }) {
  return <div className="ec-perm-row"><span>{title}</span><div className="ec-chip-list">{parseJson<string[]>(value, []).map((item) => <span className="ec-chip" key={item}>{item}</span>)}</div></div>
}
