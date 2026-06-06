import { useEffect, useState, useRef } from 'react'
import { useWidgetStore, type WidgetAgentItem } from '../stores/widget.store'
import { useTaskStore, type TaskData } from '../stores/task.store'
import { useProjectStore } from '../stores/project.store'
import { useAgentStore } from '../stores/agent.store'
import { useConnectionStore } from '../stores/connection.store'

const electronApi = (window as unknown as { electronWidget?: { togglePin: () => void; minimize: () => void; openMain: () => void } }).electronWidget

export default function WidgetPage() {
  const init = useConnectionStore((s) => s.init)
  const connected = useConnectionStore((s) => s.connected)
  const [activeTab, setActiveTab] = useState<'agents' | 'tasks'>('agents')

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!connected) return
    useProjectStore.getState().fetchProjects()
    useAgentStore.getState().fetchAgents()
    useWidgetStore.getState().loadPreferences().then(() => {
      const { pinnedProjectId } = useWidgetStore.getState().preferences
      useWidgetStore.getState().fetchAgents(pinnedProjectId, 'active')
      useTaskStore.getState().fetchTasks(pinnedProjectId || undefined)
    })
    const off1 = useWidgetStore.getState().setupListeners()
    const off2 = useTaskStore.getState().setupListeners()
    return () => { off1(); off2() }
  }, [connected])

  return (
    <div style={styles.widget}>
      <WidgetHeader />
      <WidgetTabs activeTab={activeTab} onTabChange={setActiveTab} />
      {activeTab === 'agents' ? <AgentPanel /> : <TaskPanel />}
    </div>
  )
}

function WidgetHeader() {
  const projects = useProjectStore((s) => s.projects)
  const { pinnedProjectId } = useWidgetStore((s) => s.preferences)
  const setPinnedProject = useWidgetStore((s) => s.setPinnedProject)

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value || null
    setPinnedProject(val)
    useWidgetStore.getState().fetchAgents(val, 'active')
    useTaskStore.getState().fetchTasks(val || undefined)
  }

  return (
    <div style={styles.topBar}>
      <div style={styles.connDot} />
      <select
        style={styles.projectSelect}
        value={pinnedProjectId || ''}
        onChange={handleProjectChange}
      >
        <option value="">全部项目</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {pinnedProjectId && <span style={styles.pinIcon}>📌</span>}
      <div style={styles.btns}>
        {electronApi && (
          <>
            <button style={styles.topBtn} onClick={() => electronApi.minimize()} title="收起">−</button>
            <button style={styles.topBtn} onClick={() => electronApi.openMain()} title="主窗口">□</button>
          </>
        )}
      </div>
    </div>
  )
}

function WidgetTabs({ activeTab, onTabChange }: { activeTab: string; onTabChange: (t: 'agents' | 'tasks') => void }) {
  const agentCount = useWidgetStore((s) => s.agents.length)
  const tasks = useTaskStore((s) => s.tasks)
  const { pinnedProjectId } = useWidgetStore((s) => s.preferences)
  const taskCount = pinnedProjectId
    ? tasks.filter((t) => t.project_id === pinnedProjectId && t.status !== 'completed' && t.status !== 'cancelled').length
    : tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length

  return (
    <div style={styles.tabs}>
      <div
        style={{ ...styles.tab, ...(activeTab === 'agents' ? styles.tabActive : {}) }}
        onClick={() => onTabChange('agents')}
      >
        Agent{agentCount > 0 && <span style={{ ...styles.tabCnt, ...(activeTab === 'agents' ? styles.tabCntActive : {}) }}>{agentCount}</span>}
      </div>
      <div
        style={{ ...styles.tab, ...(activeTab === 'tasks' ? styles.tabActive : {}) }}
        onClick={() => onTabChange('tasks')}
      >
        任务{taskCount > 0 && <span style={{ ...styles.tabCnt, ...(activeTab === 'tasks' ? styles.tabCntActive : {}) }}>{taskCount}</span>}
      </div>
    </div>
  )
}

function AgentPanel() {
  const agents = useWidgetStore((s) => s.agents)
  const markRead = useWidgetStore((s) => s.markRead)

  const handleAgentClick = (agent: WidgetAgentItem) => {
    if (agent.isUnread && agent.sessionId) {
      markRead(agent.sessionId)
    }
    electronApi?.openMain()
  }

  return (
    <div style={styles.panelScroll}>
      {agents.length === 0 ? (
        <div style={styles.empty}>暂无运行中的 Agent</div>
      ) : (
        agents.map((agent) => (
          <div
            key={agent.agentId}
            style={{ ...styles.agentRow, ...((!agent.isRunning && !agent.isUnread) ? { opacity: 0.4 } : {}) }}
            onClick={() => handleAgentClick(agent)}
          >
            <div style={styles.agentIcon}>
              <span style={{ fontSize: 12 }}>{agent.agentIcon || '🤖'}</span>
              {agent.isRunning && <span style={styles.liveDot} />}
              {!agent.isRunning && agent.isUnread && <span style={styles.unreadDot} />}
            </div>
            <div style={styles.agentBody}>
              <div style={styles.agentTitleRow}>
                <span style={styles.agentName}>{agent.agentName}</span>
                {agent.projectName && <span style={styles.agentProject}>{agent.projectName}</span>}
              </div>
              <div style={{
                ...styles.agentDesc,
                ...(agent.isUnread && !agent.isRunning ? { color: '#3b82f6', fontWeight: 500 } : {}),
              }}>
                {agent.isRunning
                  ? (agent.stage || '运行中...')
                  : agent.isUnread
                    ? '● 已完成 · 未读'
                    : '已完成'}
              </div>
            </div>
            <div style={styles.agentTime}>
              {agent.isRunning && agent.startedAt ? formatElapsed(agent.startedAt) : agent.closedAt ? formatTimeAgo(agent.closedAt) : ''}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function TaskPanel() {
  const tasks = useTaskStore((s) => s.tasks)
  const createTask = useTaskStore((s) => s.createTask)
  const agents = useAgentStore((s) => s.agents)
  const { pinnedProjectId, pinnedAgentId } = useWidgetStore((s) => s.preferences)
  const setPinnedAgent = useWidgetStore((s) => s.setPinnedAgent)
  const [taskFilter, setTaskFilter] = useState<'pending' | 'in_progress' | 'all'>('pending')
  const [newTitle, setNewTitle] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<string>(pinnedAgentId || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pinnedAgentId) setSelectedAgent(pinnedAgentId)
  }, [pinnedAgentId])

  const filteredTasks = tasks.filter((t) => {
    if (pinnedProjectId && t.project_id !== pinnedProjectId) return false
    if (taskFilter === 'pending') return t.status === 'backlog' || t.status === 'pending'
    if (taskFilter === 'in_progress') return t.status === 'in_progress'
    return true
  })

  const availableAgents = pinnedProjectId
    ? agents.filter((a) => a.project_id === pinnedProjectId)
    : agents

  const handleCreate = async () => {
    if (!newTitle.trim()) return
    await createTask(newTitle.trim(), undefined, selectedAgent || undefined, pinnedProjectId || undefined)
    setNewTitle('')
    inputRef.current?.focus()
  }

  const handleAgentSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    setSelectedAgent(val)
    setPinnedAgent(val || null)
  }

  return (
    <div style={styles.taskPanel}>
      <div style={styles.taskFilters}>
        {(['pending', 'in_progress', 'all'] as const).map((f) => (
          <button
            key={f}
            style={{ ...styles.taskFilterBtn, ...(taskFilter === f ? styles.taskFilterBtnActive : {}) }}
            onClick={() => setTaskFilter(f)}
          >
            {f === 'pending' ? '待处理' : f === 'in_progress' ? '进行中' : '全部'}
          </button>
        ))}
      </div>
      <div style={styles.panelScroll}>
        {filteredTasks.length === 0 ? (
          <div style={styles.empty}>暂无任务</div>
        ) : (
          filteredTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))
        )}
      </div>
      <div style={styles.quickCreate}>
        <input
          ref={inputRef}
          style={styles.quickInput}
          placeholder="新建任务..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
        />
        <select style={styles.agentPick} value={selectedAgent} onChange={handleAgentSelect}>
          <option value="">无分派</option>
          {availableAgents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button style={styles.createBtn} onClick={handleCreate}>+</button>
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: TaskData }) {
  const agents = useAgentStore((s) => s.agents)
  const agent = task.assigned_agent_id ? agents.find((a) => a.id === task.assigned_agent_id) : null

  return (
    <div style={styles.taskRow}>
      <div style={{
        ...styles.taskStatus,
        ...(task.status === 'in_progress' ? { borderColor: '#2563eb', borderWidth: 2 } : {}),
        ...(task.status === 'completed' ? { background: '#374151', borderColor: '#374151' } : {}),
      }}>
        {task.status === 'in_progress' && <div style={styles.taskStatusDot} />}
        {task.status === 'completed' && <span style={{ color: 'white', fontSize: 8 }}>✓</span>}
      </div>
      <div style={styles.taskBody}>
        <div style={{
          ...styles.taskTitle,
          ...(task.status === 'completed' ? { color: '#c8cdd5', textDecoration: 'line-through' } : {}),
        }}>
          {task.title}
        </div>
        {agent && <div style={styles.taskAgent}>→ {agent.name}</div>}
      </div>
    </div>
  )
}

function formatElapsed(startedAt: string): string {
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const mins = Math.floor(diff / 60)
  const secs = diff % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatTimeAgo(time: string): string {
  const diff = Math.floor((Date.now() - new Date(time).getTime()) / 1000)
  if (diff < 60) return `${diff}s前`
  if (diff < 3600) return `${Math.floor(diff / 60)}m前`
  return `${Math.floor(diff / 3600)}h前`
}

const styles: Record<string, React.CSSProperties> = {
  widget: {
    width: '100%',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255, 255, 255, 0.82)',
    backdropFilter: 'blur(20px)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    overflow: 'hidden',
    borderRadius: 14,
    border: '1px solid rgba(255, 255, 255, 0.45)',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '9px 12px',
    borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
    gap: 8,
    flexShrink: 0,
  },
  connDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#34d399',
    flexShrink: 0,
  },
  projectSelect: {
    fontSize: 11,
    fontWeight: 600,
    color: '#374151',
    background: 'rgba(0, 0, 0, 0.04)',
    border: 'none',
    borderRadius: 5,
    padding: '3px 8px',
    cursor: 'pointer',
    flex: 1,
    minWidth: 0,
    outline: 'none',
  },
  pinIcon: {
    fontSize: 10,
    color: '#2563eb',
    flexShrink: 0,
  },
  btns: {
    display: 'flex',
    gap: 3,
  },
  topBtn: {
    width: 20,
    height: 20,
    border: 'none',
    background: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: 4,
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    display: 'flex',
    padding: '0 12px',
    borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
    flexShrink: 0,
  },
  tab: {
    fontSize: 11,
    color: '#9ca3af',
    padding: '7px 0',
    marginRight: 16,
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  tabActive: {
    color: '#1f2937',
    fontWeight: 600,
    borderBottomColor: '#374151',
  },
  tabCnt: {
    fontSize: 9,
    background: 'rgba(0, 0, 0, 0.06)',
    color: '#6b7280',
    padding: '0 4px',
    borderRadius: 6,
    fontWeight: 600,
  },
  tabCntActive: {
    background: '#374151',
    color: 'white',
  },
  panelScroll: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
    padding: '4px 6px',
  },
  empty: {
    color: '#b0b5bf',
    fontSize: 11,
    textAlign: 'center',
    padding: '24px 0',
  },
  agentRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '7px 8px',
    borderRadius: 7,
    cursor: 'pointer',
    gap: 9,
  },
  agentIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    background: 'rgba(0, 0, 0, 0.04)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative',
  },
  liveDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#22c55e',
    border: '1.5px solid rgba(255, 255, 255, 0.9)',
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#3b82f6',
    border: '1.5px solid rgba(255, 255, 255, 0.9)',
  },
  agentBody: {
    flex: 1,
    minWidth: 0,
  },
  agentTitleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 5,
  },
  agentName: {
    fontSize: 12,
    fontWeight: 600,
    color: '#1f2937',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  agentProject: {
    fontSize: 10,
    color: '#b0b5bf',
    flexShrink: 0,
  },
  agentDesc: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  agentTime: {
    fontSize: 10,
    color: '#c8cdd5',
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
  },
  taskPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  taskFilters: {
    display: 'flex',
    gap: 0,
    padding: '4px 12px 2px',
    flexShrink: 0,
  },
  taskFilterBtn: {
    fontSize: 10,
    color: '#9ca3af',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    padding: '3px 8px',
    borderRadius: 4,
    fontWeight: 500,
  },
  taskFilterBtnActive: {
    background: 'rgba(0, 0, 0, 0.06)',
    color: '#1f2937',
    fontWeight: 600,
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: 7,
    gap: 8,
  },
  taskStatus: {
    width: 14,
    height: 14,
    border: '1.5px solid #c8cdd5',
    borderRadius: '50%',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskStatusDot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: '#2563eb',
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
  },
  taskTitle: {
    fontSize: 12,
    color: '#374151',
    lineHeight: '1.3',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  taskAgent: {
    fontSize: 10,
    color: '#b0b5bf',
    marginTop: 1,
  },
  quickCreate: {
    padding: '8px 10px',
    borderTop: '1px solid rgba(0, 0, 0, 0.04)',
    flexShrink: 0,
    display: 'flex',
    gap: 5,
    alignItems: 'center',
  },
  quickInput: {
    flex: 1,
    height: 28,
    border: '1px solid rgba(0, 0, 0, 0.08)',
    borderRadius: 6,
    padding: '0 8px',
    fontSize: 11,
    color: '#374151',
    outline: 'none',
    background: 'rgba(255, 255, 255, 0.6)',
  },
  agentPick: {
    fontSize: 10,
    color: '#6b7280',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    borderRadius: 5,
    padding: '0 6px',
    height: 28,
    background: 'rgba(255, 255, 255, 0.5)',
    cursor: 'pointer',
  },
  createBtn: {
    width: 28,
    height: 28,
    border: 'none',
    background: '#374151',
    color: 'white',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
}
