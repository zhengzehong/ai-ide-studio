import { useEffect, useState } from 'react'
import { useAgentStore } from '../stores/agent.store'
import { useConnectionStore } from '../stores/connection.store'
import { useProjectStore } from '../stores/project.store'
import { useTaskStore } from '../stores/task.store'
import { useWidgetStore } from '../stores/widget.store'
import { WidgetHeader } from './widget/WidgetHeader'
import { WidgetSessionPanel } from './widget/WidgetSessionPanel'
import { WidgetTabs } from './widget/WidgetTabs'
import { WidgetTaskPanel } from './widget/WidgetTaskPanel'
import { styles } from './widget/styles'
import type { WidgetTab } from './widget/types'

export default function WidgetPage() {
  const init = useConnectionStore((s) => s.init)
  const connected = useConnectionStore((s) => s.connected)
  const [activeTab, setActiveTab] = useState<WidgetTab>('agents')

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!connected) return
    useProjectStore.getState().fetchProjects()
    useAgentStore.getState().fetchAgents()
    useWidgetStore.getState().loadPreferences().then(() => {
      const { pinnedProjectId } = useWidgetStore.getState().preferences
      useWidgetStore.getState().fetchSessions(pinnedProjectId, 'active')
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
      {activeTab === 'agents' ? <WidgetSessionPanel /> : <WidgetTaskPanel />}
    </div>
  )
}
