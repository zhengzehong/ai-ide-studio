import { AlertCircle, Archive, CheckCircle2, CircleDot, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { EventCategoryData, EventCenterEventData } from '../../stores/event-center.store'
import type { ProjectData } from '../../stores/project.store'
import { EventTable } from '../event-center/EventTable'
import {
  filterDashboardEvents,
  type DashboardEventStatusFilter,
} from '../dashboard-view-model'

interface Props {
  events: EventCenterEventData[]
  categories: EventCategoryData[]
  projects: ProjectData[]
  selectedEventId?: string
  onSelectEvent: (eventId: string) => void
}

const statusTabs: Array<{ key: DashboardEventStatusFilter; label: string; icon: React.ReactNode }> = [
  { key: 'all', label: '全部', icon: <CircleDot size={14} /> },
  { key: 'open', label: '待处理', icon: <AlertCircle size={14} /> },
  { key: 'running', label: '处理中', icon: <Loader2 size={14} /> },
  { key: 'failed', label: '失败', icon: <Archive size={14} /> },
  { key: 'done', label: '已完成', icon: <CheckCircle2 size={14} /> },
]

export function EventTableTab({ events, categories, projects, selectedEventId, onSelectEvent }: Props) {
  const [status, setStatus] = useState<DashboardEventStatusFilter>('all')
  const [projectId, setProjectId] = useState<string | 'all'>('all')
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const visibleEvents = useMemo(
    () => filterDashboardEvents(events, { status, projectId }),
    [events, projectId, status],
  )
  const selectedEvent = visibleEvents.find((event) => event.id === selectedEventId)

  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-0)', overflow: 'hidden', minHeight: 360, display: 'flex', flexDirection: 'column' }}>
      <header style={{ minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Segment items={statusTabs} value={status} onChange={setStatus} />
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          style={selectStyle}
        >
          <option value="all">全部项目</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </header>
      <EventTable
        events={visibleEvents}
        selectedEvent={selectedEvent}
        categories={categories}
        projectsById={projectsById}
        showProjectColumn
        onSelect={onSelectEvent}
      />
    </section>
  )
}

function Segment<T extends string>({ items, value, onChange }: {
  items: Array<{ key: T; label: string; icon: React.ReactNode }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', borderRadius: 'var(--radius)', padding: 3, flexWrap: 'wrap' }}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            border: 'none',
            borderRadius: 6,
            background: value === item.key ? 'var(--bg-0)' : 'transparent',
            color: value === item.key ? 'var(--text-1)' : 'var(--text-2)',
            padding: '6px 9px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: value === item.key ? 'var(--shadow-sm)' : 'none',
          }}
        >
          {item.icon}{item.label}
        </button>
      ))}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  height: 34,
  minWidth: 150,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg-0)',
  color: 'var(--text-1)',
  padding: '0 10px',
  outline: 'none',
}
