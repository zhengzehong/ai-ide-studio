import { useEffect } from 'react'
import { useConnectionStore } from '../stores/connection.store'
import { useProjectStore } from '../stores/project.store'
import { useWidgetStore } from '../stores/widget.store'
import { WidgetAgentActivityPanel } from './widget/WidgetAgentActivityPanel'
import { WidgetHeader } from './widget/WidgetHeader'
import './widget/widget.css'

export default function WidgetPage() {
  const init = useConnectionStore((state) => state.init)
  const connected = useConnectionStore((state) => state.connected)

  useEffect(() => {
    document.documentElement.classList.add('widget-document')
    return () => document.documentElement.classList.remove('widget-document')
  }, [])

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!connected) return
    void useProjectStore.getState().fetchProjects()
    void useWidgetStore.getState().loadPreferences().then(() => {
      const { pinnedProjectId } = useWidgetStore.getState().preferences
      void useWidgetStore.getState().fetchActivities(pinnedProjectId)
    })
    return useWidgetStore.getState().setupListeners()
  }, [connected])

  return (
    <main className="widget-shell" aria-label="AI IDE Studio Agent 动态">
      <WidgetHeader />
      <WidgetAgentActivityPanel />
    </main>
  )
}
