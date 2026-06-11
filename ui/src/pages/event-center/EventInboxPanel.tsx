import { LayoutList, Plus, Search, Table2 } from 'lucide-react'
import { useState } from 'react'
import { useEventCenterStore, type EventCenterEventData } from '../../stores/event-center.store'
import { categoryName, formatTime, parseJson, PRIORITY_META, STATUS_META } from './helpers'
import { EventCreateModal } from './EventCreateModal'
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

type ViewMode = 'table' | 'summary'

export function EventInboxPanel({ projectId }: { projectId: string | null }) {
  const events = useEventCenterStore((s) => s.events)
  const categories = useEventCenterStore((s) => s.categories)
  const selectedEventId = useEventCenterStore((s) => s.selectedEventId)
  const selectEvent = useEventCenterStore((s) => s.selectEvent)
  const fetchEvents = useEventCenterStore((s) => s.fetchEvents)
  const eventTotal = useEventCenterStore((s) => s.eventTotal)
  const eventLimit = useEventCenterStore((s) => s.eventLimit)
  const eventOffset = useEventCenterStore((s) => s.eventOffset)
  const eventStatus = useEventCenterStore((s) => s.eventStatus)
  const eventCategoryId = useEventCenterStore((s) => s.eventCategoryId)
  const eventKeyword = useEventCenterStore((s) => s.eventKeyword)
  const [keyword, setKeyword] = useState(eventKeyword)
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [creating, setCreating] = useState(false)
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0]

  const page = Math.floor(eventOffset / eventLimit) + 1
  const pageCount = Math.max(1, Math.ceil(eventTotal / eventLimit))
  const pageStart = eventTotal === 0 ? 0 : eventOffset + 1
  const pageEnd = Math.min(eventOffset + events.length, eventTotal)

  const reload = (filter: { status?: string; categoryId?: string; keyword?: string; limit?: number; offset?: number }) => {
    void fetchEvents(projectId ?? undefined, filter)
  }

  const changeStatus = (status: string) => {
    reload({ status, categoryId: eventCategoryId, keyword, limit: eventLimit, offset: 0 })
  }

  const changeCategory = (categoryId: string) => {
    reload({ status: eventStatus, categoryId, keyword, limit: eventLimit, offset: 0 })
  }

  const submitSearch = () => {
    reload({ status: eventStatus, categoryId: eventCategoryId, keyword, limit: eventLimit, offset: 0 })
  }

  const changeLimit = (limit: number) => {
    reload({ status: eventStatus, categoryId: eventCategoryId, keyword, limit, offset: 0 })
  }

  const goPage = (offset: number) => {
    reload({ status: eventStatus, categoryId: eventCategoryId, keyword, limit: eventLimit, offset })
  }

  return (
    <div className="ec-inbox">
      <aside className="ec-filter-rail">
        <div className="ec-rail-title">状态</div>
        {STATUS_FILTERS.map((item) => (
          <button key={item.key} className={`ec-filter ${eventStatus === item.key ? 'active' : ''}`} onClick={() => changeStatus(item.key)}>
            <span>{item.label}</span>{item.key === 'all' && <b>{eventTotal}</b>}
          </button>
        ))}
        <div className="ec-rail-section">
          <div className="ec-rail-title">类别</div>
          <button className={`ec-filter ${eventCategoryId === 'all' ? 'active' : ''}`} onClick={() => changeCategory('all')}>
            <span>全部类别</span>
          </button>
          {categories.map((category) => (
            <button className={`ec-filter ${eventCategoryId === category.id ? 'active' : ''}`} key={category.id} onClick={() => changeCategory(category.id)}>
              <span>{category.name}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="ec-list-pane">
        <div className="ec-list-toolbar">
          <div className="ec-search">
            <Search size={14} />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
              placeholder="搜索事件、来源、标签..."
            />
          </div>
          <div className="ec-segment">
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} title="表格视图"><Table2 size={14} /></button>
            <button className={viewMode === 'summary' ? 'active' : ''} onClick={() => setViewMode('summary')} title="摘要视图"><LayoutList size={14} /></button>
          </div>
          <button className="ec-btn" onClick={submitSearch}>搜索</button>
          <button className="ec-btn ec-btn--primary" onClick={() => setCreating(true)}><Plus size={14} />新建事件</button>
        </div>
        {viewMode === 'table' ? (
          <EventTable events={events} selectedEvent={selectedEvent} onSelect={selectEvent} />
        ) : (
          <div className="ec-event-list">
            {events.map((event) => (
              <EventSummaryRow key={event.id} event={event} active={event.id === selectedEvent?.id} onClick={() => selectEvent(event.id)} />
            ))}
            {events.length === 0 && <div className="ec-empty">没有匹配的事件</div>}
          </div>
        )}
        <div className="ec-pagination">
          <span>{pageStart}-{pageEnd} / {eventTotal}</span>
          <select value={eventLimit} onChange={(e) => changeLimit(Number(e.target.value))}>
            <option value={30}>30 条/页</option>
            <option value={50}>50 条/页</option>
            <option value={100}>100 条/页</option>
          </select>
          <button className="ec-btn" disabled={page <= 1} onClick={() => goPage(Math.max(0, eventOffset - eventLimit))}>上一页</button>
          <span>第 {page} / {pageCount} 页</span>
          <button className="ec-btn" disabled={page >= pageCount} onClick={() => goPage(eventOffset + eventLimit)}>下一页</button>
        </div>
      </section>
      <EventDetailPanel event={selectedEvent} projectId={projectId} />
      <EventCreateModal open={creating} projectId={projectId} onClose={() => setCreating(false)} />
    </div>
  )
}

function EventTable({ events, selectedEvent, onSelect }: {
  events: EventCenterEventData[]
  selectedEvent: EventCenterEventData | undefined
  onSelect: (eventId: string) => void
}) {
  const categories = useEventCenterStore((s) => s.categories)

  return (
    <div className="ec-table-scroll">
      <table className="ec-table ec-event-table">
        <thead>
          <tr>
            <th>状态</th>
            <th>优先级</th>
            <th>类别</th>
            <th>标题</th>
            <th>来源</th>
            <th>置信度</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className={event.id === selectedEvent?.id ? 'active' : ''} onClick={() => onSelect(event.id)}>
              <td><span className="ec-chip" style={{ color: STATUS_META[event.status]?.color }}>{STATUS_META[event.status]?.label ?? event.status}</span></td>
              <td><span className={PRIORITY_META[event.priority]?.className ?? 'ec-chip'}>{PRIORITY_META[event.priority]?.label ?? event.priority}</span></td>
              <td>{categoryName(categories, event.category_id)}</td>
              <td><strong>{event.title}</strong></td>
              <td>{event.source_label || event.source_type}</td>
              <td>{Math.round(event.confidence * 100)}%</td>
              <td>{formatTime(event.created_at)}</td>
            </tr>
          ))}
          {events.length === 0 && <tr><td colSpan={7}><div className="ec-empty">没有匹配的事件</div></td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function EventSummaryRow({ event, active, onClick }: { event: EventCenterEventData; active: boolean; onClick: () => void }) {
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
