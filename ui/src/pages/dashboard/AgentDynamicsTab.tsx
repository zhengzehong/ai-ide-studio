import { AlertTriangle, Columns3, FolderKanban, ListFilter, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { ProjectData } from '../../stores/project.store'
import type { SessionData } from '../../stores/session.store'
import type { TaskData } from '../../stores/task.store'
import {
  buildAgentDynamicsViewModel,
  type AgentDynamicsFilter,
  type AgentDynamicsRow,
  type AgentDynamicsView,
} from '../dashboard-view-model'

interface Props {
  agents: AgentData[]
  projects: ProjectData[]
  sessions: SessionData[]
  tasks: TaskData[]
  selectedSessionId?: string
  onSelectSession?: (sessionId: string) => void
}

const filterTabs: Array<{ key: AgentDynamicsFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'needs_attention', label: '需处理' },
  { key: 'running', label: '运行中' },
  { key: 'idle', label: '仅空闲' },
]

const viewTabs: Array<{ key: AgentDynamicsView; label: string; icon: React.ReactNode }> = [
  { key: 'agent', label: '按 Agent', icon: <UserRound size={14} /> },
  { key: 'project', label: '按项目', icon: <FolderKanban size={14} /> },
  { key: 'timeline', label: '时间线', icon: <Columns3 size={14} /> },
]

export function AgentDynamicsTab({ agents, projects, sessions, tasks, selectedSessionId, onSelectSession }: Props) {
  const [filter, setFilter] = useState<AgentDynamicsFilter>('all')
  const [view, setView] = useState<AgentDynamicsView>('agent')
  const [historyOpen, setHistoryOpen] = useState(false)
  const model = useMemo(
    () => buildAgentDynamicsViewModel({ agents, projects, sessions, tasks, filter, view }),
    [agents, filter, projects, sessions, tasks, view],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Segment items={filterTabs} value={filter} onChange={setFilter} />
        <Segment items={viewTabs} value={view} onChange={setView} />
      </div>
      {model.groups.length === 0 && model.historyRows.length === 0 && <EmptyState />}
      {model.groups.map((group) => (
        <section key={group.id} style={{ border: '1px solid var(--border)', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <header style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 15 }}>{group.title}</strong>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{group.rows.length}</span>
          </header>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {group.rows.map((row) => (
              <SessionRow key={row.session.id} row={row} active={row.session.id === selectedSessionId} onSelect={onSelectSession} />
            ))}
          </div>
        </section>
      ))}
      {model.historyRows.length > 0 && (
        <section style={{ border: '1px solid var(--border)', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <button type="button" onClick={() => setHistoryOpen((open) => !open)} style={{ width: '100%', padding: '10px 14px', border: 'none', borderBottom: historyOpen ? '1px solid var(--border)' : 'none', background: 'transparent', color: 'var(--text-2)', fontSize: 14, fontWeight: 600, display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
            <span>历史会话 ({model.historyRows.length})</span>
            <span>{historyOpen ? '收起' : '展开'}</span>
          </button>
          {historyOpen && model.historyRows.map((row) => (
            <SessionRow key={row.session.id} row={row} active={row.session.id === selectedSessionId} onSelect={onSelectSession} />
          ))}
        </section>
      )}
    </div>
  )
}

function Segment<T extends string>({ items, value, onChange }: {
  items: Array<{ key: T; label: string; icon?: React.ReactNode }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', borderRadius: 'var(--radius)', padding: 3 }}>
      {items.map((item) => (
        <button
          key={item.key}
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

function SessionRow({ row, active, onSelect }: { row: AgentDynamicsRow; active: boolean; onSelect?: (sessionId: string) => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect?.(row.session.id)}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 12,
        alignItems: 'center',
        width: '100%',
        padding: '12px 14px',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        background: row.isAbnormal ? '#fef2f2' : active ? 'var(--blue-light)' : 'transparent',
        boxShadow: active ? 'inset 3px 0 0 var(--blue)' : 'none',
        color: 'var(--text-1)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <strong style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</strong>
          {row.isAbnormal && <AlertTriangle size={14} color="var(--red)" />}
        </div>
        <div style={{ display: 'flex', gap: 8, color: 'var(--text-2)', fontSize: 13, flexWrap: 'wrap' }}>
          <span>{row.agent?.name ?? row.session.agent_id}</span>
          <span>{row.project?.name ?? '未归属项目'}</span>
          <span>{row.subtitle}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge kind={row.badge.kind} value={row.badge.value} abnormal={row.isAbnormal} />
        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{formatTime(row.lastActivityAt)}</span>
      </div>
    </button>
  )
}

function Badge({ kind, value, abnormal }: { kind: 'task' | 'activity'; value: string; abnormal: boolean }) {
  const label = kind === 'activity' ? (value === 'running' ? '运行中' : '空闲') : taskStatusLabel(value)
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 999,
      background: abnormal ? '#fee2e2' : kind === 'activity' && value === 'idle' ? 'var(--bg-2)' : 'var(--blue-light)',
      color: abnormal ? 'var(--red)' : kind === 'activity' && value === 'idle' ? 'var(--text-3)' : 'var(--blue)',
      fontSize: 13,
      fontWeight: 600,
    }}>
      {label}
    </span>
  )
}

function taskStatusLabel(status: string): string {
  const map: Record<string, string> = {
    backlog: '待办',
    planning: '规划中',
    executing: '执行中',
    blocked: '已阻塞',
    reviewing: '审查中',
    completed: '已完成',
    cancelled: '已取消',
  }
  return map[status] ?? status
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function EmptyState() {
  return (
    <div style={{ border: '1px solid var(--border)', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', padding: 28, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
      <ListFilter size={18} style={{ marginBottom: 8 }} />
      <div>没有匹配的会话</div>
    </div>
  )
}
