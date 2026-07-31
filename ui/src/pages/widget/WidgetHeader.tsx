import { ExternalLink, Minus, Pin } from 'lucide-react'
import { useAgentStore } from '../../stores/agent.store'
import { useConnectionStore } from '../../stores/connection.store'
import { useProjectStore } from '../../stores/project.store'
import { useTaskStore } from '../../stores/task.store'
import { useWidgetStore } from '../../stores/widget.store'
import { styles } from './styles'
import { electronApi } from './types'

export function WidgetHeader() {
  const projects = useProjectStore((s) => s.projects)
  const { pinnedProjectId, pinnedAgentId } = useWidgetStore((s) => s.preferences)
  const setPinnedProject = useWidgetStore((s) => s.setPinnedProject)
  const setPinnedAgent = useWidgetStore((s) => s.setPinnedAgent)
  const agents = useAgentStore((s) => s.agents)
  const api = electronApi
  const connected = useConnectionStore((s) => s.connected)
  const authError = useConnectionStore((s) => s.authError)

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = e.target.value || null
    const pinnedAgent = pinnedAgentId ? agents.find((agent) => agent.id === pinnedAgentId) : null
    void setPinnedProject(projectId)
    if (pinnedAgent && projectId && pinnedAgent.project_id !== projectId) {
      void setPinnedAgent(null)
    }
    useWidgetStore.getState().fetchSessions(projectId, 'recent')
    useTaskStore.getState().fetchTasks(projectId || undefined)
  }

  return (
    <div style={styles.topBar}>
      <div
        style={{ ...styles.connDot, background: connected ? '#22c55e' : authError ? '#ef4444' : '#9ca3af' }}
        title={connected ? '已连接' : authError || '正在连接'}
      />
      <select style={styles.projectSelect} value={pinnedProjectId || ''} onChange={handleProjectChange}>
        <option value="">全部项目</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
      {pinnedProjectId && <Pin size={12} color="#2563eb" />}
      <div style={styles.btns}>
        {api && (
          <>
            <button style={styles.topBtn} onClick={() => void api.minimize()} title="收起">
              <Minus size={13} />
            </button>
            <button style={styles.topBtn} onClick={() => void api.openMain()} title="主窗口">
              <ExternalLink size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
