import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bot, CheckCircle2, Loader2, Wifi, WifiOff } from 'lucide-react'
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
import { ContextPanel, type DashboardContext } from './dashboard/ContextPanel'
import { EventTableTab } from './dashboard/EventTableTab'
import { QuickDispatcher } from './dashboard/QuickDispatcher'
import { TaskTableTab } from './dashboard/TaskTableTab'

const tabs: Array<{ key: DashboardTab; label: string }> = [
  { key: 'agents', label: 'Agent 动态' },
  { key: 'tasks', label: '任务' },
  { key: 'events', label: '事件' },
]

export default function Dashboard() {
  const [scope, setScope] = useState<DashboardScope>({ type: 'all' })
  const [activeTab, setActiveTab] = useState<DashboardTab>('agents')
  const [context, setContext] = useState<DashboardContext>({ kind: 'empty' })
  const connected = useConnectionStore((state) => state.connected)
  const agents = useAgentStore((state) => state.agents)
  const fetchAgents = useAgentStore((state) => state.fetchAgents)
  const sessions = useSessionStore((state) => state.sessions)
  const fetchSessions = useSessionStore((state) => state.fetchSessions)
  const tasks = useTaskStore((state) => state.tasks)
  const fetchTasks = useTaskStore((state) => state.fetchTasks)
  const events = useEventCenterStore((state) => state.events)
  const categories = useEventCenterStore((state) => state.categories)
  const fetchEvents = useEventCenterStore((state) => state.fetchEvents)
  const fetchCategories = useEventCenterStore((state) => state.fetchCategories)
  const setupEventListeners = useEventCenterStore((state) => state.setupListeners)
  const projects = useProjectStore((state) => state.projects)
  const agentsLoading = useAgentStore((state) => state.loading)
  const sessionsLoading = useSessionStore((state) => state.loading)
  const tasksLoading = useTaskStore((state) => state.loading)
  const eventsLoading = useEventCenterStore((state) => state.loading)

  const dashboard = useMemo(
    () => buildDashboardViewModel({ agents, sessions, tasks, events, projects, scope }),
    [agents, events, projects, scope, sessions, tasks],
  )
  const loading = agentsLoading || sessionsLoading || tasksLoading || eventsLoading
  const scopeProjectId = dashboardScopeProjectId(scope)

  useEffect(() => setupEventListeners(), [setupEventListeners])

  useEffect(() => {
    void fetchAgents()
    void fetchTasks()
    void fetchSessions(undefined, undefined)
    void fetchEvents(undefined, { offset: 0 })
    void fetchCategories(undefined).catch(() => undefined)
  }, [fetchAgents, fetchCategories, fetchEvents, fetchSessions, fetchTasks])

  useEffect(() => {
    if (context.kind === 'session' && !dashboard.sessions.some((session) => session.id === context.sessionId)) setContext({ kind: 'empty' })
    if (context.kind === 'task' && !dashboard.tasks.some((task) => task.id === context.taskId)) setContext({ kind: 'empty' })
    if (context.kind === 'event' && !dashboard.events.some((event) => event.id === context.eventId)) setContext({ kind: 'empty' })
  }, [context, dashboard.events, dashboard.sessions, dashboard.tasks])

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
            type="button"
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

      <main style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 18, minHeight: 420 }}>
        <section style={{ minWidth: 0 }}>
          {activeTab === 'agents' && (
            loading && dashboard.agents.length === 0 && dashboard.sessions.length === 0
              ? <SkeletonRows label="正在加载 Agent 动态" />
              : (
                <AgentDynamicsTab
                  agents={dashboard.agents}
                  projects={projects}
                  sessions={dashboard.sessions}
                  tasks={dashboard.tasks}
                  selectedSessionId={context.kind === 'session' ? context.sessionId : undefined}
                  onSelectSession={(sessionId) => setContext({ kind: 'session', sessionId })}
                />
              )
          )}
          {activeTab === 'tasks' && (
            loading && dashboard.tasks.length === 0
              ? <SkeletonRows label="正在加载任务" />
              : (
                <TaskTableTab
                  agents={dashboard.agents}
                  projects={projects}
                  tasks={dashboard.tasks}
                  selectedTaskId={context.kind === 'task' ? context.taskId : undefined}
                  onSelectTask={(taskId) => setContext({ kind: 'task', taskId })}
                />
              )
          )}
          {activeTab === 'events' && (
            loading && dashboard.events.length === 0
              ? <SkeletonRows label="正在加载事件" />
              : (
                <EventTableTab
                  events={dashboard.events}
                  categories={categories}
                  projects={projects}
                  selectedEventId={context.kind === 'event' ? context.eventId : undefined}
                  onSelectEvent={(eventId) => setContext({ kind: 'event', eventId })}
                />
              )
          )}
        </section>
        <ContextPanel
          context={context}
          agents={dashboard.agents}
          sessions={dashboard.sessions}
          tasks={dashboard.tasks}
          events={dashboard.events}
          projects={projects}
          projectId={scopeProjectId ?? null}
          onChangeContext={setContext}
        />
      </main>

      <QuickDispatcher
        agents={dashboard.agents}
        projects={projects}
        tasks={dashboard.tasks}
        scope={scope}
        onCreated={(taskId) => {
          setActiveTab('tasks')
          setContext({ kind: 'task', taskId })
        }}
      />
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

function StatCard({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{ padding: '16px 18px', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 38, height: 38, borderRadius: 'var(--radius)', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>{icon}</div>
      <div><div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</div><div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>{label}</div></div>
    </div>
  )
}
