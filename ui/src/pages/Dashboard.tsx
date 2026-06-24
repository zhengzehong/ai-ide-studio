import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, Bot, CheckCircle2, Loader2, Plus, Wifi, WifiOff, Zap } from 'lucide-react'
import { DashboardScopeSwitcher } from '../components/dashboard/DashboardScopeSwitcher'
import { useAgentStore } from '../stores/agent.store'
import { useConnectionStore } from '../stores/connection.store'
import { useEventCenterStore } from '../stores/event-center.store'
import { useProjectStore } from '../stores/project.store'
import { useSessionStore } from '../stores/session.store'
import { useTaskStore } from '../stores/task.store'
import {
  buildDashboardViewModel,
  dashboardScopeProjectId,
  type DashboardScope,
  type DashboardTab,
} from './dashboard-view-model'
import { AgentDynamicsTab } from './dashboard/AgentDynamicsTab'

const tabs: Array<{ key: DashboardTab; label: string }> = [
  { key: 'agents', label: 'Agent 动态' },
  { key: 'tasks', label: '任务' },
  { key: 'events', label: '事件' },
]

export default function Dashboard() {
  const [scope, setScope] = useState<DashboardScope>({ type: 'all' })
  const [activeTab, setActiveTab] = useState<DashboardTab>('agents')
  const connected = useConnectionStore((s) => s.connected)
  const agents = useAgentStore((s) => s.agents)
  const sessions = useSessionStore((s) => s.sessions)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const tasks = useTaskStore((s) => s.tasks)
  const events = useEventCenterStore((s) => s.events)
  const fetchEvents = useEventCenterStore((s) => s.fetchEvents)
  const fetchCategories = useEventCenterStore((s) => s.fetchCategories)
  const projects = useProjectStore((s) => s.projects)
  const agentsLoading = useAgentStore((s) => s.loading)
  const sessionsLoading = useSessionStore((s) => s.loading)
  const tasksLoading = useTaskStore((s) => s.loading)
  const eventsLoading = useEventCenterStore((s) => s.loading)

  const dashboard = useMemo(
    () => buildDashboardViewModel({ agents, sessions, tasks, events, projects, scope }),
    [agents, events, projects, scope, sessions, tasks],
  )
  const loading = agentsLoading || sessionsLoading || tasksLoading || eventsLoading
  const scopeProjectId = dashboardScopeProjectId(scope)

  useEffect(() => {
    void fetchSessions(undefined, scopeProjectId)
    void fetchEvents(scopeProjectId, { offset: 0 })
    void fetchCategories(scopeProjectId).catch(() => undefined)
  }, [fetchCategories, fetchEvents, fetchSessions, scopeProjectId])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '24px 28px 96px', position: 'relative' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>全局看板</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {connected ? <Wifi size={13} color="var(--green)" /> : <WifiOff size={13} color="var(--red)" />}
            <p style={{ fontSize: 15, color: 'var(--text-2)', margin: 0 }}>
              {connected ? `${dashboard.stats.runningAgents} 个智能体运行中，${dashboard.stats.activeSessions} 个活跃会话` : '未连接到后端 Gateway'}
            </p>
          </div>
        </div>
        <DashboardScopeSwitcher scope={scope} projects={projects} onChange={setScope} />
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14, marginBottom: 18 }}>
        <StatCard icon={<Bot size={18} />} label="运行中 Agent" value={dashboard.stats.runningAgents} color="var(--blue)" bg="var(--blue-light)" />
        <StatCard icon={<Loader2 size={18} />} label="进行中任务" value={dashboard.stats.inProgressTasks} color="var(--purple)" bg="var(--purple-light)" />
        <StatCard icon={<CheckCircle2 size={18} />} label="已完成任务" value={dashboard.stats.completedTasks} color="var(--green)" bg="var(--green-light)" />
        <StatCard icon={<AlertCircle size={18} />} label="活跃会话" value={dashboard.stats.activeSessions} color="var(--orange)" bg="var(--orange-light)" />
      </section>

      <nav style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--blue)' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.key ? 'var(--blue)' : 'var(--text-2)',
              padding: '10px 12px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 18, minHeight: 420 }}>
        <section style={{ minWidth: 0 }}>
          {activeTab === 'agents' && (
            loading && dashboard.agents.length === 0 && dashboard.sessions.length === 0
              ? <SkeletonRows label="正在加载 Agent 动态" />
              : <AgentDynamicsTab agents={dashboard.agents} projects={projects} sessions={dashboard.sessions} tasks={dashboard.tasks} />
          )}
          {activeTab === 'tasks' && <TaskShell tasks={dashboard.tasks} loading={loading} />}
          {activeTab === 'events' && <EventShell events={dashboard.events} loading={loading} />}
        </section>
        <aside style={{ border: '1px solid var(--border)', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', padding: 16, minHeight: 300 }}>
          <SectionHeader icon={<Activity size={15} />} title="上下文" />
          <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
            {scopeProjectId ? '当前看板已按单项目过滤，顶部全局项目选择器不会随之变化。' : '当前展示全部项目数据。选择左侧会话、任务或事件后，这里会显示详情。'}
          </p>
        </aside>
      </main>

      <div style={{ position: 'sticky', bottom: 16, marginTop: 20, border: '1px solid var(--border)', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Zap size={15} color="var(--text-3)" />
        <span style={{ color: 'var(--text-2)', fontSize: 14, flex: 1 }}>快速派发条将在 Phase 3 接入任务创建。</span>
        <button disabled style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)', color: 'var(--text-3)', padding: '7px 12px' }}>
          <Plus size={13} /> 新建
        </button>
      </div>
    </div>
  )
}

function TaskShell({ tasks, loading }: { tasks: ReturnType<typeof buildDashboardViewModel>['tasks']; loading: boolean }) {
  if (loading && tasks.length === 0) return <SkeletonRows label="正在加载任务" />
  if (tasks.length === 0) return <EmptyState label="暂无任务" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tasks.slice(0, 20).map((task) => (
        <div key={task.id} style={{ padding: '14px 16px', background: 'var(--bg-0)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
            <strong style={{ fontSize: 15 }}>{task.title}</strong>
            <TaskStatusBadge status={task.status} />
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{task.stage || task.status}</div>
        </div>
      ))}
    </div>
  )
}

function EventShell({ events, loading }: { events: ReturnType<typeof buildDashboardViewModel>['events']; loading: boolean }) {
  if (loading && events.length === 0) return <SkeletonRows label="正在加载事件" />
  if (events.length === 0) return <EmptyState label="暂无事件" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {events.slice(0, 20).map((event) => (
        <div key={event.id} style={{ padding: '14px 16px', background: 'var(--bg-0)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
            <strong style={{ fontSize: 15 }}>{event.title}</strong>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{event.status}</span>
          </div>
          <div style={{ color: 'var(--text-2)', fontSize: 14 }}>{event.summary || event.source_label || event.source_type}</div>
        </div>
      ))}
    </div>
  )
}

function SkeletonRows({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2].map((item) => (
        <div key={item} style={{ height: 62, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-0)', display: 'flex', alignItems: 'center', padding: '0 16px', color: 'var(--text-3)', fontSize: 14 }}>
          {item === 0 ? label : ''}
        </div>
      ))}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div style={{ border: '1px solid var(--border)', background: 'var(--bg-0)', borderRadius: 'var(--radius)', padding: 28, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>{label}</div>
}

function StatCard({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{ padding: '16px 18px', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 38, height: 38, borderRadius: 'var(--radius)', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>{icon}</div>
      <div><div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</div><div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>{label}</div></div>
    </div>
  )
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
      <span style={{ color: 'var(--text-3)' }}>{icon}</span>{title}
    </div>
  )
}

function TaskStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    executing: { bg: 'var(--blue-light)', color: 'var(--blue)', label: '进行中' },
    planning: { bg: 'var(--purple-light)', color: 'var(--purple)', label: '规划中' },
    reviewing: { bg: 'var(--yellow-light)', color: 'var(--yellow)', label: '审查中' },
    blocked: { bg: 'var(--red-light)', color: 'var(--red)', label: '已阻塞' },
    completed: { bg: 'var(--green-light)', color: 'var(--green)', label: '已完成' },
    backlog: { bg: 'var(--bg-2)', color: 'var(--text-3)', label: '待办' },
  }
  const item = map[status] ?? map.backlog
  return <span style={{ fontSize: 13, padding: '2px 8px', borderRadius: 10, background: item.bg, color: item.color, fontWeight: 500, flexShrink: 0 }}>{item.label}</span>
}
