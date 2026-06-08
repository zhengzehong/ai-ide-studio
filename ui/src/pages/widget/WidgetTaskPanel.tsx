import { useMemo, useRef, useState } from 'react'
import { Check, Circle, Plus } from 'lucide-react'
import { useAgentStore } from '../../stores/agent.store'
import { useTaskStore, type TaskData } from '../../stores/task.store'
import { useWidgetStore } from '../../stores/widget.store'
import { taskStatusMeta } from './format'
import { styles } from './styles'
import { ACTIVE_TASK_STATUSES, type TaskFilter } from './types'

export function WidgetTaskPanel() {
  const tasks = useTaskStore((s) => s.tasks)
  const createTask = useTaskStore((s) => s.createTask)
  const agents = useAgentStore((s) => s.agents)
  const { pinnedProjectId, pinnedAgentId } = useWidgetStore((s) => s.preferences)
  const setPinnedAgent = useWidgetStore((s) => s.setPinnedAgent)
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('backlog')
  const [newTitle, setNewTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const availableAgents = useMemo(
    () => pinnedProjectId ? agents.filter((agent) => agent.project_id === pinnedProjectId) : agents,
    [agents, pinnedProjectId],
  )
  const selectedAgent = pinnedAgentId && availableAgents.some((agent) => agent.id === pinnedAgentId)
    ? pinnedAgentId
    : ''

  const filteredTasks = tasks.filter((task) => {
    if (pinnedProjectId && task.project_id !== pinnedProjectId) return false
    if (taskFilter === 'backlog') return task.status === 'backlog'
    if (taskFilter === 'active') return ACTIVE_TASK_STATUSES.has(task.status)
    return true
  })

  const handleCreate = async () => {
    const title = newTitle.trim()
    if (!title) return
    await createTask(title, undefined, selectedAgent || undefined, pinnedProjectId || undefined)
    setNewTitle('')
    inputRef.current?.focus()
  }

  const handleAgentSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const agentId = e.target.value
    void setPinnedAgent(agentId || null)
  }

  return (
    <div style={styles.taskPanel}>
      <div style={styles.taskFilters}>
        {(['backlog', 'active', 'all'] as const).map((filter) => (
          <button
            key={filter}
            style={{ ...styles.taskFilterBtn, ...(taskFilter === filter ? styles.taskFilterBtnActive : {}) }}
            onClick={() => setTaskFilter(filter)}
          >
            {filter === 'backlog' ? '待办' : filter === 'active' ? '进行中' : '全部'}
          </button>
        ))}
      </div>
      <div style={styles.panelScroll}>
        {filteredTasks.length === 0 ? (
          <div style={styles.empty}>暂无任务</div>
        ) : (
          filteredTasks.map((task) => <TaskRow key={task.id} task={task} />)
        )}
      </div>
      <div style={styles.quickCreate}>
        <input
          ref={inputRef}
          style={styles.quickInput}
          placeholder="新建任务..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
        />
        <select style={styles.agentPick} value={selectedAgent} onChange={handleAgentSelect}>
          <option value="">无分派</option>
          {availableAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
        <button style={styles.createBtn} onClick={() => void handleCreate()} title="创建任务">
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: TaskData }) {
  const agents = useAgentStore((s) => s.agents)
  const agent = task.assigned_agent_id ? agents.find((item) => item.id === task.assigned_agent_id) : null
  const meta = taskStatusMeta(task.status)

  return (
    <div style={styles.taskRow}>
      <div style={{ ...styles.taskStatus, borderColor: meta.color, background: meta.filled ? meta.color : 'transparent' }}>
        {task.status === 'completed'
          ? <Check size={9} color="white" />
          : meta.active
            ? <div style={{ ...styles.taskStatusDot, background: meta.color }} />
            : <Circle size={8} color={meta.color} />}
      </div>
      <div style={styles.taskBody}>
        <div style={{
          ...styles.taskTitle,
          ...(task.status === 'completed' ? { color: '#9ca3af', textDecoration: 'line-through' } : {}),
        }}>
          {task.title}
        </div>
        <div style={styles.taskMetaRow}>
          <span style={{ ...styles.taskBadge, color: meta.color }}>{meta.label}</span>
          {agent && <span style={styles.taskAgent}>→ {agent.name}</span>}
        </div>
      </div>
    </div>
  )
}
