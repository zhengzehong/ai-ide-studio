import { useCallback, useEffect, useState } from 'react'
import { useConnectionStore } from '../stores/connection.store'
import { useProjectStore } from '../stores/project.store'
import { useWidgetStore } from '../stores/widget.store'
import { WidgetAgentActivityPanel } from './widget/WidgetAgentActivityPanel'
import { WidgetHeader } from './widget/WidgetHeader'
import { getNextWidgetTheme, readWidgetTheme, saveWidgetTheme } from './widget/widget-theme'
import './widget/widget.css'

export default function WidgetPage() {
  const init = useConnectionStore((state) => state.init)
  const connected = useConnectionStore((state) => state.connected)
  const [theme, setTheme] = useState(() => readWidgetTheme(window.localStorage))

  const cycleTheme = useCallback((): void => {
    setTheme((current) => {
      const next = getNextWidgetTheme(current)
      saveWidgetTheme(window.localStorage, next)
      return next
    })
  }, [])

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
    <main className="widget-shell" data-theme={theme} aria-label="AI IDE Studio Agent 动态">
      <WidgetHeader theme={theme} onCycleTheme={cycleTheme} />
      <WidgetAgentActivityPanel />
    </main>
  )
}
