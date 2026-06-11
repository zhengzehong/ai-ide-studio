import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useEventCenterStore, type EventCenterEventData } from '../../stores/event-center.store'
import { categoryName, formatTime, parseJson, PRIORITY_META, STATUS_META } from './helpers'
import { EventDetailPanel } from './EventDetailPanel'

const STATUS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '未处理' },
  { key: 'running', label: '处理中' },
  { key: 'consumed', label: '已消费' },
  { key: 'failed', label: '处理失败' },
  { key: 'ignored', label: '已忽略' },
  { key: 'task', label: '已转任务' },
  { key: 'archived', label: '已归档' },
]

export function EventInboxPanel({ projectId }: { projectId: string | null }) {
  const events = useEventCenterStore((s) => s.events)
  const categories = useEventCenterStore((s) => s.categories)
  const selectedEventId = useEventCenterStore((s) => s.selectedEventId)
  const selectEvent = useEventCenterStore((s) => s.selectEvent)
  const createEvent = useEventCenterStore((s) => s.createEvent)
  const [status, setStatus] = useState('all')
  const [keyword, setKeyword] = useState('')
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0]

  const filtered = useMemo(() => events.filter((event) => {
    if (status !== 'all' && event.status !== status) return false
    if (!keyword.trim()) return true
    const tags = parseJson<string[]>(event.tags_json, []).join(' ')
    return `${event.title} ${event.summary ?? ''} ${event.source_label ?? ''} ${tags}`.toLowerCase().includes(keyword.toLowerCase())
  }), [events, keyword, status])

  const counts = useMemo(() => {
    const next: Record<string, number> = { all: events.length }
    for (const event of events) next[event.status] = (next[event.status] ?? 0) + 1
    return next
  }, [events])

  const simulateEvent = async () => {
    await createEvent({
      projectId: projectId ?? undefined,
      categoryId: 'ai.hot_project',
      title: '新发现的 Agent 调试工具',
      summary: '采集 Agent 写入了一条事件，用来验证订阅和消费链路。',
      priority: 'medium',
      confidence: 0.82,
      tags: ['Agent', 'Debug'],
      payload: { projectName: 'Agent Debug Kit', hotReason: '工具调用时间线调试能力被多次提到', recommendedAction: '交给分析 Agent 判断是否试用' },
      evidence: [{ title: '模拟采集记录', url: 'collector://mock/agent-debug-kit' }],
    })
  }

  return (
    <div className="ec-inbox">
      <aside className="ec-filter-rail">
        <div className="ec-rail-title">状态</div>
        {STATUS_FILTERS.map((item) => (
          <button key={item.key} className={`ec-filter ${status === item.key ? 'active' : ''}`} onClick={() => setStatus(item.key)}>
            <span>{item.label}</span><b>{counts[item.key] ?? 0}</b>
          </button>
        ))}
        <div className="ec-rail-section">
          <div className="ec-rail-title">类别</div>
          <div className="ec-chip-list">{categories.map((category) => <span className="ec-chip ec-chip--blue" key={category.id}>{category.name}</span>)}</div>
        </div>
      </aside>
      <section className="ec-list-pane">
        <div className="ec-list-toolbar">
          <div className="ec-search"><Search size={14} /><input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索事件、来源、标签..." /></div>
          <button className="ec-btn ec-btn--primary" onClick={simulateEvent}><Plus size={14} />模拟写入</button>
        </div>
        <div className="ec-event-list">
          {filtered.map((event) => (
            <EventRow key={event.id} event={event} active={event.id === selectedEvent?.id} onClick={() => selectEvent(event.id)} />
          ))}
          {filtered.length === 0 && <div className="ec-empty">没有匹配的事件</div>}
        </div>
      </section>
      <EventDetailPanel event={selectedEvent} projectId={projectId} />
    </div>
  )
}

function EventRow({ event, active, onClick }: { event: EventCenterEventData; active: boolean; onClick: () => void }) {
  const categories = useEventCenterStore((s) => s.categories)
  const tags = parseJson<string[]>(event.tags_json, [])

  return (
    <button className={`ec-event-row ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="ec-row-main">
        <div className="ec-row-meta">
          <span className="ec-chip ec-chip--blue">{categoryName(categories, event.category_id)}</span>
          <span className="ec-chip" style={{ color: STATUS_META[event.status]?.color }}>{STATUS_META[event.status]?.label ?? event.status}</span>
          <span className={PRIORITY_META[event.priority]?.className ?? 'ec-chip'}>{PRIORITY_META[event.priority]?.label ?? event.priority}</span>
        </div>
        <strong>{event.title}</strong>
        <p>{event.summary || '暂无摘要'}</p>
        <small>{event.source_label || event.source_type} · {tags.join(' / ') || '无标签'}</small>
      </div>
      <div className="ec-row-side">
        <span>{formatTime(event.created_at)}</span>
        <b>{Math.round(event.confidence * 100)}%</b>
      </div>
    </button>
  )
}
