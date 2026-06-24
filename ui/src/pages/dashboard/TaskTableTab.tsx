import { CheckCircle2, CircleDashed, Clock3, ListChecks, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { ProjectData } from '../../stores/project.store'
import type { TaskData } from '../../stores/task.store'
import {
  filterDashboardTasks,
  type DashboardTaskStatusFilter,
} from '../dashboard-view-model'

interface Props {
  agents: AgentData[]
  projects: ProjectData[]
  tasks: TaskData[]
  selectedTaskId?: string
  onSelectTask: (taskId: string) => void
}

const statusTabs: Array<{ key: DashboardTaskStatusFilter; label: string; icon: React.ReactNode }> = [
  { key: 'all', label: '全部', icon: <ListChecks size={14} /> },
  { key: 'backlog', label: '待办', icon: <CircleDashed size={14} /> },
  { key: 'active', label: '进行中', icon: <Clock3 size={14} /> },
  { key: 'needs_attention', label: '需处理', icon: <Search size={14} /> },
  { key: 'done', label: '已完成', icon: <CheckCircle2 size={14} /> },
]

const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
  backlog: { label: '待办', color: 'var(--text-3)', bg: 'var(--bg-2)' },
  planning: { label: '规划中', color: 'var(--purple)', bg: 'var(--purple-light)' },
  executing: { label: '执行中', color: 'var(--blue)', bg: 'var(--blue-light)' },
  needs_input: { label: '待确认', color: '#d97706', bg: '#fef3c7' },
  blocked: { label: '已阻塞', color: 'var(--red)', bg: '#fee2e2' },
  reviewing: { label: '审查中', color: '#2563eb', bg: '#dbeafe' },
  completed: { label: '已完成', color: 'var(--green)', bg: 'var(--green-light)' },
  cancelled: { label: '已取消', color: 'var(--text-3)', bg: 'var(--bg-2)' },
}

export function TaskTableTab({ agents, projects, tasks, selectedTaskId, onSelectTask }: Props) {
  const [status, setStatus] = useState<DashboardTaskStatusFilter>('all')
  const [projectId, setProjectId] = useState<string | 'all'>('all')
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const visibleTasks = useMemo(
    () => filterDashboardTasks(tasks, { status, projectId }),
    [projectId, status, tasks],
  )

  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-0)', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <header style={{ minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
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
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 13 }}>
          <colgroup>
            <col style={{ width: '32%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: 'var(--bg-1)', color: 'var(--text-3)' }}>
              <HeaderCell>任务</HeaderCell>
              <HeaderCell>状态</HeaderCell>
              <HeaderCell>项目</HeaderCell>
              <HeaderCell>Agent</HeaderCell>
              <HeaderCell>阶段</HeaderCell>
              <HeaderCell>创建时间</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {visibleTasks.map((task) => {
              const meta = statusMeta[task.status] ?? statusMeta.backlog
              const projectName = task.project_id ? projectsById.get(task.project_id)?.name ?? task.project_id : '未归属'
              const agentName = task.assigned_agent_id ? agentsById.get(task.assigned_agent_id)?.name ?? task.assigned_agent_id : '未指派'
              const active = task.id === selectedTaskId
              return (
                <tr
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  style={{ background: active ? 'var(--blue-light)' : 'transparent', cursor: 'pointer' }}
                >
                  <BodyCell><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</strong></BodyCell>
                  <BodyCell><StatusBadge label={meta.label} color={meta.color} bg={meta.bg} /></BodyCell>
                  <BodyCell><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{projectName}</span></BodyCell>
                  <BodyCell><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{agentName}</span></BodyCell>
                  <BodyCell><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{task.stage || task.status}</span></BodyCell>
                  <BodyCell><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{formatTime(task.created_at)}</span></BodyCell>
                </tr>
              )
            })}
            {visibleTasks.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 32, color: 'var(--text-3)', textAlign: 'center' }}>没有匹配的任务</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Segment<T extends string>({ items, value, onChange }: {
  items: Array<{ key: T; label: string; icon: React.ReactNode }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', borderRadius: 'var(--radius)', padding: 3, flexShrink: 0, overflow: 'hidden' }}>
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
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: value === item.key ? 'var(--shadow-sm)' : 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {item.icon}{item.label}
        </button>
      ))}
    </div>
  )
}

function HeaderCell({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</th>
}

function BodyCell({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-light)', color: 'var(--text-2)', verticalAlign: 'middle', overflow: 'hidden' }}>{children}</td>
}

function StatusBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 22, borderRadius: 999, background: bg, color, fontSize: 12, fontWeight: 700, padding: '2px 8px', whiteSpace: 'nowrap' }}>{label}</span>
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

const selectStyle: React.CSSProperties = {
  height: 32,
  minWidth: 140,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg-2)',
  color: 'var(--text-1)',
  padding: '0 10px',
  outline: 'none',
  fontSize: 13,
  flexShrink: 0,
}
