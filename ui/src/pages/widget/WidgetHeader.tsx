import { useEffect, useState } from 'react'
import { Minus } from 'lucide-react'
import { useConnectionStore } from '../../stores/connection.store'
import { useProjectStore } from '../../stores/project.store'
import { useWidgetStore } from '../../stores/widget.store'
import { electronApi } from './types'
import { WidgetPinButton } from './WidgetPinButton'

export function WidgetHeader() {
  const api = electronApi
  const projects = useProjectStore((state) => state.projects)
  const pinnedProjectId = useWidgetStore((state) => state.preferences.pinnedProjectId)
  const setPinnedProject = useWidgetStore((state) => state.setPinnedProject)
  const connected = useConnectionStore((state) => state.connected)
  const authError = useConnectionStore((state) => state.authError)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    let active = true
    void api?.getPinState()
      .then((value) => { if (active) setPinned(value) })
      .catch(() => undefined)
    return () => { active = false }
  }, [api])

  const handleProjectChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const projectId = event.target.value || null
    void setPinnedProject(projectId)
    void useWidgetStore.getState().fetchActivities(projectId)
  }

  const connectionLabel = connected ? '已连接' : authError ? '连接失败' : '连接中'

  const handlePinToggle = async (): Promise<void> => {
    if (!api) return
    setPinned(await api.togglePin())
  }

  return (
    <header className="widget-titlebar">
      <span className="widget-brand-mark" aria-hidden="true"><img src="/app-icon.svg" alt="" /></span>
      <div className="widget-header-actions">
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
          <WidgetPinButton pinned={pinned} onToggle={() => void handlePinToggle()} />
          <button className="widget-icon-button" onClick={() => void api.minimize()} title="隐藏组件" aria-label="隐藏组件"><Minus size={17} /></button>
          </>
        )}
      </div>
    </header>
  )
}
