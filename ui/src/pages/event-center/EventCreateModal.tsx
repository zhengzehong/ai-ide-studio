import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useEventCenterStore } from '../../stores/event-center.store'
import { categoryFields } from './helpers'

const priorityOptions = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

interface Props {
  open: boolean
  projectId: string | null
  onClose: () => void
}

export function EventCreateModal({ open, projectId, onClose }: Props) {
  const categories = useEventCenterStore((s) => s.categories)
  const createEvent = useEventCenterStore((s) => s.createEvent)
  const enabledCategories = useMemo(() => categories.filter((category) => category.enabled === 1), [categories])
  const [categoryId, setCategoryId] = useState(enabledCategories[0]?.id ?? '')
  const selectedCategory = enabledCategories.find((category) => category.id === categoryId) ?? enabledCategories[0]
  const fields = useMemo(() => categoryFields(selectedCategory), [selectedCategory])
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [priority, setPriority] = useState('medium')
  const [tags, setTags] = useState('')
  const [sourceLabel, setSourceLabel] = useState('人工录入')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const submit = async () => {
    setError('')
    if (!selectedCategory) {
      setError('请先创建或启用一个事件类别')
      return
    }
    if (!title.trim()) {
      setError('请填写事件标题')
      return
    }
    if (!summary.trim()) {
      setError('请填写事件说明或原因')
      return
    }
    const missing = fields.find((field) => field.required && !fieldValues[field.key]?.trim())
    if (missing) {
      setError(`请填写类别字段：${missing.label}`)
      return
    }

    setSubmitting(true)
    try {
      await createEvent({
        projectId: projectId ?? undefined,
        categoryId: selectedCategory.id,
        title: title.trim(),
        summary: summary.trim(),
        sourceType: 'manual',
        sourceLabel: sourceLabel.trim() || '人工录入',
        priority,
        confidence: 1,
        tags: splitTags(tags),
        payload: buildPayload(fieldValues, fields.map((field) => field.key)),
      })
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建事件失败')
    } finally {
      setSubmitting(false)
    }
  }

  const close = () => {
    if (submitting) return
    onClose()
  }

  const reset = () => {
    setTitle('')
    setSummary('')
    setPriority('medium')
    setTags('')
    setSourceLabel('人工录入')
    setFieldValues({})
    setError('')
  }

  return (
    <div className="ec-modal-backdrop" role="presentation">
      <div className="ec-modal" role="dialog" aria-modal="true" aria-labelledby="event-create-title">
        <div className="ec-modal-head">
          <div>
            <h2 id="event-create-title">新建事件</h2>
            <p>记录一条需要订阅、处理或转成任务的正式事件。</p>
          </div>
          <button className="ec-icon-btn" onClick={close} aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="ec-modal-body">
          <label className="ec-field">
            <span>事件类别</span>
            <select value={selectedCategory?.id ?? ''} onChange={(e) => setCategoryId(e.target.value)}>
              {enabledCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="ec-field">
            <span>标题</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：发现一个值得评估的新 AI 项目" />
          </label>
          <label className="ec-field">
            <span>事件说明 / 原因</span>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="说明事件背景、为什么值得关注，以及建议怎么处理" />
          </label>
          <div className="ec-form-grid">
            <label className="ec-field">
              <span>优先级</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="ec-field">
              <span>来源名称</span>
              <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="例如：人工录入 / AI 趋势采集" />
            </label>
          </div>
          <label className="ec-field">
            <span>标签</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="多个标签用逗号分隔" />
          </label>
          {fields.length > 0 && (
            <section className="ec-form-section">
              <h3>类别字段</h3>
              <div className="ec-form-grid">
                {fields.map((field) => (
                  <label className="ec-field" key={field.key}>
                    <span>{field.label}{field.required ? ' *' : ''}</span>
                    <input
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) => setFieldValues((current) => ({ ...current, [field.key]: e.target.value }))}
                      placeholder={field.placeholder || `填写${field.label}`}
                    />
                  </label>
                ))}
              </div>
            </section>
          )}
          {error && <div className="ec-form-error">{error}</div>}
        </div>
        <div className="ec-modal-actions">
          <button className="ec-btn" onClick={close} disabled={submitting}>取消</button>
          <button className="ec-btn ec-btn--primary" onClick={submit} disabled={submitting}>{submitting ? '创建中...' : '创建事件'}</button>
        </div>
      </div>
    </div>
  )
}

function splitTags(value: string): string[] {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
}

function buildPayload(values: Record<string, string>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, values[key] ?? '']).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]))
}
