import { useEventCenterStore, type EventCategoryData, type EventCenterEventData } from '../../stores/event-center.store'
import { categoryFields, categoryName, formatTime, parseJson, PRIORITY_META, STATUS_META } from './helpers'
import './event-center.css'

interface EventTableProps {
  events: EventCenterEventData[]
  selectedEvent: EventCenterEventData | undefined
  categories?: EventCategoryData[]
  projectsById?: Map<string, string>
  showProjectColumn?: boolean
  onSelect: (eventId: string) => void
}

export function EventTable({ events, selectedEvent, categories: categoriesProp, projectsById, showProjectColumn = false, onSelect }: EventTableProps) {
  const storeCategories = useEventCenterStore((s) => s.categories)
  const categories = categoriesProp ?? storeCategories
  const colSpan = showProjectColumn ? 7 : 6

  return (
    <div className="ec-table-scroll">
      <table className="ec-table ec-event-table">
        <thead>
          <tr>
            <th>状态</th>
            <th>优先级</th>
            <th>类别</th>
            {showProjectColumn && <th>项目</th>}
            <th>标题</th>
            <th>说明</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className={event.id === selectedEvent?.id ? 'active' : ''} onClick={() => onSelect(event.id)}>
              <td><span className="ec-chip" style={{ color: STATUS_META[event.status]?.color }}>{STATUS_META[event.status]?.label ?? event.status}</span></td>
              <td><span className={PRIORITY_META[event.priority]?.className ?? 'ec-chip'}>{PRIORITY_META[event.priority]?.label ?? event.priority}</span></td>
              <td>{categoryName(categories, event.category_id)}</td>
              {showProjectColumn && <td>{event.project_id ? projectsById?.get(event.project_id) ?? event.project_id : '未归属'}</td>}
              <td><strong>{event.title}</strong></td>
              <td>
                <div>{event.summary || event.source_label || event.source_type}</div>
                <EventPayloadChips event={event} categories={categories} />
              </td>
              <td>{formatTime(event.created_at)}</td>
            </tr>
          ))}
          {events.length === 0 && <tr><td colSpan={colSpan}><div className="ec-empty">没有匹配的事件</div></td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export function EventSummaryRow({ event, active, categories: categoriesProp, onClick }: {
  event: EventCenterEventData
  active: boolean
  categories?: EventCategoryData[]
  onClick: () => void
}) {
  const storeCategories = useEventCenterStore((s) => s.categories)
  const categories = categoriesProp ?? storeCategories
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
        <EventPayloadChips event={event} categories={categories} />
        <small>{event.source_label || event.source_type} · {tags.join(' / ') || '无标签'}</small>
      </div>
      <div className="ec-row-side">
        <span>{formatTime(event.created_at)}</span>
        <b>{event.source_label || event.source_type}</b>
      </div>
    </button>
  )
}

function EventPayloadChips({ event, categories }: { event: EventCenterEventData; categories: EventCategoryData[] }) {
  const category = categories.find((item) => item.id === event.category_id)
  const payload = parseJson<Record<string, unknown>>(event.payload_json, {})
  const chips = categoryFields(category)
    .filter((field) => field.list)
    .map((field) => ({ field, value: payload[field.key] }))
    .filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim() !== '')

  if (chips.length === 0) return null
  return (
    <div className="ec-chip-row">
      {chips.map(({ field, value }) => (
        <span className="ec-chip" key={field.key}>{field.label}: {formatPayloadValue(value)}</span>
      ))}
    </div>
  )
}

function formatPayloadValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
