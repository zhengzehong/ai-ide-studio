import { useEffect, useMemo, useState } from 'react'
import { Wifi, WifiOff } from 'lucide-react'
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
  const visibleContext = useMemo<DashboardContext>(() => {
    if (context.kind === 'session') {
      return dashboard.sessions.some((session) => session.id === context.sessionId) ? context : { kind: 'empty' }
    }
    if (context.kind === 'task') {
      return dashboard.tasks.some((task) => task.id === context.taskId) ? context : { kind: 'empty' }
    }
    if (context.kind === 'event') {
      return dashboard.events.some((event) => event.id === context.eventId) ? context : { kind: 'empty' }
    }
    return context
  }, [context, dashboard.events, dashboard.sessions, dashboard.tasks])

  useEffect(() => setupEventListeners(), [setupEventListeners])

  useEffect(() => {
    void fetchAgents()
    void fetchTasks()
    void fetchSessions(undefined, undefined)
    void fetchEvents(undefined, { offset: 0 })
    void fetchCategories(undefined).catch(() => undefined)
  }, [fetchAgents, fetchCategories, fetchEvents, fetchSessions, fetchTasks])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '20px 28px 16px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 16, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>全局看板</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {connected ? <Wifi size={13} color="var(--green)" /> : <WifiOff size={13} color="var(--red)" />}
            <p style={{ fontSize: 14, color: 'var(--text-2)', margin: 0 }}>
              {connected ? `${dashboard.stats.runningAgents} 个智能体运行中，${dashboard.stats.activeSessions} 个活跃会话` : '未连接到后端 Gateway'}
            </p>
          </div>
        </div>
        <DashboardScopeSwitcher scope={scope} projects={projects} onChange={setScope} />
      </header>

      <nav style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', marginBottom: 14, flexShrink: 0 }}>
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
              padding: '8px 12px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 16, flex: 1, minHeight: 0 }}>
        <section style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'agents' && (
            loading && dashboard.agents.length === 0 && dashboard.sessions.length === 0
              ? <SkeletonRows label="正在加载 Agent 动态" />
              : (
                <AgentDynamicsTab
                  agents={dashboard.agents}
                  projects={projects}
                  sessions={dashboard.sessions}
                  tasks={dashboard.tasks}
                  selectedSessionId={visibleContext.kind === 'session' ? visibleContext.sessionId : undefined}
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
                  selectedTaskId={visibleContext.kind === 'task' ? visibleContext.taskId : undefined}
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
                  selectedEventId={visibleContext.kind === 'event' ? visibleContext.eventId : undefined}
                  onSelectEvent={(eventId) => setContext({ kind: 'event', eventId })}
                />
              )
          )}
        </section>
        <ContextPanel
          context={visibleContext}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
      {[0, 1, 2].map((item) => (
        <div key={item} style={{ height: 62, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-0)', display: 'flex', alignItems: 'center', padding: '0 16px', color: 'var(--text-3)', fontSize: 14 }}>
          {item === 0 ? label : ''}
        </div>
      ))}
    </div>
  )
}
