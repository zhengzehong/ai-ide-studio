import { Archive, CheckSquare, Play, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useEventCenterStore, type EventCenterEventData } from '../../stores/event-center.store'
import { categoryFields, categoryName, parseJson, PRIORITY_META, STATUS_META } from './helpers'

interface Props {
  event: EventCenterEventData | undefined
  projectId: string | null
}

export function EventDetailPanel({ event, projectId }: Props) {
  const categories = useEventCenterStore((s) => s.categories)
  const details = useEventCenterStore((s) => s.details)
  const fetchEventDetail = useEventCenterStore((s) => s.fetchEventDetail)
  const runConsumer = useEventCenterStore((s) => s.runConsumer)
  const convertToTask = useEventCenterStore((s) => s.convertToTask)
  const ignoreEvent = useEventCenterStore((s) => s.ignoreEvent)
  const archiveEvent = useEventCenterStore((s) => s.archiveEvent)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (event?.id) void fetchEventDetail(event.id).catch(() => undefined)
  }, [event?.id, fetchEventDetail])

  const detail = event ? details[event.id] : null
  const payload = useMemo(() => parseJson<Record<string, unknown>>(event?.payload_json, {}), [event?.payload_json])
  const selectedCategory = categories.find((category) => category.id === event?.category_id)
  const fields = useMemo(() => categoryFields(selectedCategory), [selectedCategory])

  if (!event) return <aside className="ec-detail"><div className="ec-empty">请选择一个事件</div></aside>

  const action = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn() } finally { setBusy(null) }
  }

  return (
    <aside className="ec-detail">
      <div className="ec-detail-head">
        <div className="ec-row-meta">
          <span className="ec-chip ec-chip--blue">{categoryName(categories, event.category_id)}</span>
          <span className="ec-chip" style={{ color: STATUS_META[event.status]?.color }}>{STATUS_META[event.status]?.label ?? event.status}</span>
          <span className={PRIORITY_META[event.priority]?.className ?? 'ec-chip'}>{PRIORITY_META[event.priority]?.label ?? event.priority}</span>
        </div>
        <h2>{event.title}</h2>
        <p>{event.summary || '暂无说明'}</p>
      </div>
      <div className="ec-detail-body">
        <Section title="类别字段">
          <div className="ec-kv">
            {fields.length > 0
              ? fields.map((field) => <div className="ec-kv-row" key={field.key}><span>{field.label}</span><b>{String(payload[field.key] ?? '-')}</b></div>)
              : Object.entries(payload).map(([key, value]) => <div className="ec-kv-row" key={key}><span>{key}</span><b>{String(value)}</b></div>)}
            {fields.length === 0 && Object.keys(payload).length === 0 && <div className="ec-muted">暂无类别字段</div>}
          </div>
        </Section>
        <Section title="消费记录">
          <div className="ec-timeline">
            {(detail?.consumptions ?? []).map((item) => (
              <div className="ec-timeline-item" key={item.id}>
                <span className={`ec-dot ec-dot--${item.status}`} />
                <div>
                  <strong>{item.consumer_label || item.consumer_agent_id || '消费者'}</strong>
                  <p>{item.result_summary || item.error || item.status}</p>
                  {item.session_id && <p>会话：{item.session_id}</p>}
                </div>
              </div>
            ))}
            {detail?.consumptions.length === 0 && <div className="ec-muted">暂无消费记录</div>}
          </div>
        </Section>
      </div>
      <div className="ec-detail-actions">
        <button className="ec-btn ec-btn--primary" disabled={!!busy} onClick={() => action('run', () => runConsumer(event.id, projectId ?? undefined))}><Play size={14} />{busy === 'run' ? '运行中...' : '运行消费者'}</button>
        <button className="ec-btn" disabled={!!busy} onClick={() => action('task', () => convertToTask(event.id, { title: event.title, description: event.summary ?? undefined, projectId: projectId ?? undefined }))}><CheckSquare size={14} />转任务</button>
        <button className="ec-btn" disabled={!!busy} onClick={() => action('archive', () => archiveEvent(event.id))}><Archive size={14} />归档</button>
        <button className="ec-btn ec-btn--danger" disabled={!!busy} onClick={() => action('ignore', () => ignoreEvent(event.id))}><X size={14} />忽略</button>
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="ec-section"><h3>{title}</h3>{children}</section>
}
