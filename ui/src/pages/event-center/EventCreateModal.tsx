import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useEventCenterStore } from '../../stores/event-center.store'

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
  const [categoryId, setCategoryId] = useState('ai.hot_project')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [priority, setPriority] = useState('medium')
  const [confidence, setConfidence] = useState(80)
  const [tags, setTags] = useState('')
  const [sourceLabel, setSourceLabel] = useState('人工录入')
  const [payloadJson, setPayloadJson] = useState('{}')
  const [evidenceText, setEvidenceText] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const enabledCategories = useMemo(() => categories.filter((category) => category.enabled === 1), [categories])

  if (!open) return null

  const submit = async () => {
    setError('')
    if (!categoryId) {
      setError('请选择事件类别')
      return
    }
    if (!title.trim()) {
      setError('请填写事件标题')
      return
    }

    const payload = parseJsonObject(payloadJson)
    if (!payload.ok) {
      setError('Payload JSON 格式不正确')
      return
    }

    setSubmitting(true)
    try {
      await createEvent({
        projectId: projectId ?? undefined,
        categoryId,
        title: title.trim(),
        summary: summary.trim() || undefined,
        sourceType: 'manual',
        sourceLabel: sourceLabel.trim() || '人工录入',
        priority,
        confidence: confidence / 100,
        tags: splitTags(tags),
        payload: payload.value,
        evidence: parseEvidence(evidenceText),
      })
      onClose()
      reset()
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
    setConfidence(80)
    setTags('')
    setSourceLabel('人工录入')
    setPayloadJson('{}')
    setEvidenceText('')
    setError('')
  }

  return (
    <div className="ec-modal-backdrop" role="presentation">
      <div className="ec-modal" role="dialog" aria-modal="true" aria-labelledby="event-create-title">
        <div className="ec-modal-head">
          <div>
            <h2 id="event-create-title">新建事件</h2>
            <p>人工写入一条正式事件，用于进入订阅、消费或转任务流程。</p>
          </div>
          <button className="ec-icon-btn" onClick={close} aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="ec-modal-body">
          <label className="ec-field">
            <span>事件类别</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {enabledCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="ec-field">
            <span>标题</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：发现一个值得评估的新 AI 项目" />
          </label>
          <label className="ec-field">
            <span>摘要</span>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="简短说明事件背景和推荐动作" />
          </label>
          <div className="ec-form-grid">
            <label className="ec-field">
              <span>优先级</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="ec-field">
              <span>置信度：{confidence}%</span>
              <input type="range" min="0" max="100" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
            </label>
          </div>
          <div className="ec-form-grid">
            <label className="ec-field">
              <span>来源名称</span>
              <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
            </label>
            <label className="ec-field">
              <span>标签</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="多个标签用逗号分隔" />
            </label>
          </div>
          <label className="ec-field">
            <span>Payload JSON</span>
            <textarea className="ec-code-input" value={payloadJson} onChange={(e) => setPayloadJson(e.target.value)} rows={5} />
          </label>
          <label className="ec-field">
            <span>证据</span>
            <textarea value={evidenceText} onChange={(e) => setEvidenceText(e.target.value)} rows={3} placeholder="每行一条：标题 | URL" />
          </label>
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

function parseEvidence(value: string): Array<{ title: string; url?: string }> {
  const items: Array<{ title: string; url?: string }> = []
  for (const line of value.split('\n')) {
    const [title, url] = line.split('|').map((item) => item.trim())
    if (title) items.push({ title, url: url || undefined })
  }
  return items
}

function parseJsonObject(value: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false }
  }
}
