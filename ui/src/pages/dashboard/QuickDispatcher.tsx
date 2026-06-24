import { SendHorizonal, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { ProjectData } from '../../stores/project.store'
import { useTaskStore, type TaskData } from '../../stores/task.store'
import {
  chooseQuickDispatchProjectId,
  type DashboardScope,
} from '../dashboard-view-model'

interface Props {
  agents: AgentData[]
  projects: ProjectData[]
  tasks: TaskData[]
  scope: DashboardScope
  onCreated?: (taskId: string) => void
}

export function QuickDispatcher({ agents, projects, tasks, scope, onCreated }: Props) {
  const createTask = useTaskStore((state) => state.createTask)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [agentId, setAgentId] = useState('')
  const [creating, setCreating] = useState(false)
  const defaultProjectId = useMemo(
    () => chooseQuickDispatchProjectId({ scope, tasks, projects }) ?? '',
    [projects, scope, tasks],
  )
  const projectLocked = scope.type === 'project'
  const selectedProjectId = projectLocked ? defaultProjectId : (projectId || defaultProjectId)
  const availableAgents = useMemo(
    () => agents.filter((agent) => !selectedProjectId || !agent.project_id || agent.project_id === selectedProjectId),
    [agents, selectedProjectId],
  )
  const effectiveAgentId = availableAgents.some((agent) => agent.id === agentId) ? agentId : ''
  const canCreate = Boolean(title.trim() && selectedProjectId && !creating)

  const submit = async () => {
    const nextTitle = title.trim()
    if (!nextTitle || !selectedProjectId) return
    setCreating(true)
    try {
      const task = await createTask(nextTitle, undefined, effectiveAgentId || undefined, selectedProjectId)
      setTitle('')
      onCreated?.(task.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ position: 'sticky', bottom: 0, marginTop: 12, border: '1px solid var(--border)', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 10, display: 'grid', gridTemplateColumns: 'auto minmax(160px, 1fr) minmax(130px, 160px) minmax(130px, 160px) auto', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <Sparkles size={16} color="var(--blue)" style={{ flexShrink: 0 }} />
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit()
        }}
        placeholder="快速派发一个新任务..."
        style={inputStyle}
      />
      <select
        value={selectedProjectId}
        disabled={projectLocked}
        onChange={(event) => setProjectId(event.target.value)}
        style={inputStyle}
      >
        <option value="">选择项目</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <select value={effectiveAgentId} onChange={(event) => setAgentId(event.target.value)} style={inputStyle}>
        <option value="">不指派 Agent</option>
        {availableAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      <button type="button" disabled={!canCreate} onClick={() => void submit()} style={{ ...buttonStyle, opacity: canCreate ? 1 : 0.55, flexShrink: 0 }}>
        <SendHorizonal size={14} />{creating ? '创建中' : '派发'}
      </button>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  height: 34,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-1)',
  color: 'var(--text-1)',
  padding: '0 10px',
  outline: 'none',
  fontSize: 14,
  minWidth: 0,
  width: '100%',
}

const buttonStyle: React.CSSProperties = {
  height: 36,
  border: 'none',
  borderRadius: 8,
  background: 'var(--blue)',
  color: 'white',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
