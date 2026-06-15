import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { useEventCenterStore, type EventCategoryData } from '../../stores/event-center.store'
import { categoryFields } from './helpers'

const priorityOptions = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

interface CategoryFieldDraft {
  key: string
  label: string
  type: string
  required: boolean
  placeholder: string
}

interface Props {
  open: boolean
  category?: EventCategoryData
  projectId?: string | null
  onClose: () => void
}

export function CategoryCreateModal({ open, category, projectId, onClose }: Props) {
  if (!open) return null
  return <CategoryForm key={category?.id ?? 'new'} category={category} projectId={projectId} onClose={onClose} />
}

function CategoryForm({ category, projectId, onClose }: { category?: EventCategoryData; projectId?: string | null; onClose: () => void }) {
  const createCategory = useEventCenterStore((s) => s.createCategory)
  const updateCategory = useEventCenterStore((s) => s.updateCategory)
  const initialFields = category ? categoryFields(category).map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    placeholder: field.placeholder,
  })) : []
  const [name, setName] = useState(category?.name ?? '')
  const [categoryId, setCategoryId] = useState(category?.id ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [defaultPriority, setDefaultPriority] = useState(category?.default_priority || 'medium')
  const [enabled, setEnabled] = useState(category ? category.enabled === 1 : true)
  const [fields, setFields] = useState<CategoryFieldDraft[]>(initialFields.length > 0 ? initialFields : [emptyField()])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setError('')
    const trimmedName = name.trim()
    const trimmedId = categoryId.trim()
    if (!trimmedName) {
      setError('请填写类别名称')
      return
    }
    if (!trimmedId || !/^[a-z0-9][a-z0-9._-]*$/.test(trimmedId)) {
      setError('类别标识只能包含小写字母、数字、点、下划线或短横线')
      return
    }
    const normalizedFields = fields
      .map((field) => ({ ...field, key: field.key.trim(), label: field.label.trim(), placeholder: field.placeholder.trim() }))
      .filter((field) => field.key || field.label)
    const invalidField = normalizedFields.find((field) => !field.key || !/^[A-Za-z][A-Za-z0-9_]*$/.test(field.key) || !field.label)
    if (invalidField) {
      setError('字段 key 必须以字母开头，并且每个字段都要有名称')
      return
    }
    const duplicated = normalizedFields.find((field, index) => normalizedFields.findIndex((item) => item.key === field.key) !== index)
    if (duplicated) {
      setError(`字段 key 重复：${duplicated.key}`)
      return
    }

    setSubmitting(true)
    try {
      const input = {
        categoryId: trimmedId,
        name: trimmedName,
        description: description.trim() || undefined,
        defaultPriority,
        enabled,
        schema: buildSchema(normalizedFields),
      }
      if (category) await updateCategory(input, projectId ?? undefined)
      else await createCategory(input, projectId ?? undefined)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存事件类别失败')
    } finally {
      setSubmitting(false)
    }
  }

  const close = () => {
    if (submitting) return
    onClose()
  }

  const updateField = (index: number, patch: Partial<CategoryFieldDraft>) => {
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field))
  }

  return (
    <div className="ec-modal-backdrop" role="presentation">
      <div className="ec-modal" role="dialog" aria-modal="true" aria-labelledby="category-create-title">
        <div className="ec-modal-head">
          <div>
            <h2 id="category-create-title">{category ? '编辑事件类别' : '新建事件类别'}</h2>
            <p>定义事件的业务分类，以及该分类需要填写的字段模板。</p>
          </div>
          <button className="ec-icon-btn" onClick={close} aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="ec-modal-body">
          <div className="ec-form-grid">
            <label className="ec-field">
              <span>类别名称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：AI 趋势" />
            </label>
            <label className="ec-field">
              <span>类别标识</span>
              <input value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={Boolean(category)} placeholder="例如：ai.trend" />
            </label>
          </div>
          <label className="ec-field">
            <span>类别说明</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="说明这个类别记录什么事件，以及适合怎么处理" />
          </label>
          <div className="ec-form-grid">
            <label className="ec-field">
              <span>默认优先级</span>
              <select value={defaultPriority} onChange={(e) => setDefaultPriority(e.target.value)}>
                {priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="ec-checkbox ec-checkbox--field">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>启用类别</span>
            </label>
          </div>
          <section className="ec-form-section">
            <div className="ec-section-head">
              <h3>字段模板</h3>
              <button className="ec-btn" onClick={() => setFields((current) => [...current, emptyField()])}><Plus size={14} />添加字段</button>
            </div>
            <div className="ec-field-editor">
              <div className="ec-field-editor-head">
                <span>字段名称</span>
                <span>字段 key</span>
                <span>说明</span>
                <span>必填</span>
                <span />
              </div>
              {fields.map((field, index) => (
                <div className="ec-field-editor-row" key={`${field.key}-${index}`}>
                  <input value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} placeholder="项目名" />
                  <input value={field.key} onChange={(e) => updateField(index, { key: e.target.value })} placeholder="projectName" />
                  <input value={field.placeholder} onChange={(e) => updateField(index, { placeholder: e.target.value })} placeholder="字段填写提示" />
                  <label className="ec-mini-check"><input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} /></label>
                  <button className="ec-icon-btn" onClick={() => setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index))} aria-label="删除字段"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </section>
          {error && <div className="ec-form-error">{error}</div>}
        </div>
        <div className="ec-modal-actions">
          <button className="ec-btn" onClick={close} disabled={submitting}>取消</button>
          <button className="ec-btn ec-btn--primary" onClick={submit} disabled={submitting}>{submitting ? '保存中...' : '保存类别'}</button>
        </div>
      </div>
    </div>
  )
}

function emptyField(): CategoryFieldDraft {
  return { key: '', label: '', type: 'string', required: false, placeholder: '' }
}

function buildSchema(fields: CategoryFieldDraft[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map((field) => [
      field.key,
      { type: field.type || 'string', title: field.label, description: field.placeholder },
    ])),
    required: fields.filter((field) => field.required).map((field) => field.key),
  }
}
