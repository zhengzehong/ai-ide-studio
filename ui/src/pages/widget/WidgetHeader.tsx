import { Minus, Pin, Sparkles } from 'lucide-react'
import { useConnectionStore } from '../../stores/connection.store'
import { useProjectStore } from '../../stores/project.store'
import { useWidgetStore } from '../../stores/widget.store'
import { electronApi } from './types'

export function WidgetHeader() {
  const api = electronApi
  const projects = useProjectStore((state) => state.projects)
  const pinnedProjectId = useWidgetStore((state) => state.preferences.pinnedProjectId)
  const setPinnedProject = useWidgetStore((state) => state.setPinnedProject)
  const connected = useConnectionStore((state) => state.connected)
  const authError = useConnectionStore((state) => state.authError)

  const handleProjectChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const projectId = event.target.value || null
    void setPinnedProject(projectId)
    void useWidgetStore.getState().fetchActivities(projectId)
  }

  const connectionLabel = connected ? '已连接' : authError ? '连接失败' : '连接中'

  return (
    <header className="widget-titlebar">
      <span className="widget-brand-mark" aria-hidden="true"><Sparkles size={15} /></span>
      <select className="widget-project-select" value={pinnedProjectId || ''} onChange={handleProjectChange} aria-label="选择项目">
        <option value="">全部项目</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <span className={`widget-connection widget-connection--${connected ? 'online' : authError ? 'error' : 'pending'}`}>
        <span className="widget-connection-dot" />
        <span className="widget-connection-label">{connectionLabel}</span>
      </span>
      {api && (
        <>
          <button className="widget-icon-button" onClick={() => void api.togglePin()} title="固定组件" aria-label="固定组件"><Pin size={16} /></button>
          <button className="widget-icon-button" onClick={() => void api.minimize()} title="隐藏组件" aria-label="隐藏组件"><Minus size={17} /></button>
        </>
      )}
    </header>
  )
}
