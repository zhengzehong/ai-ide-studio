import { useEffect, useRef, useState } from 'react'
import { useSessionDockStore } from '../stores/session-dock.store'
import { useWorkbenchSessionStore } from '../stores/workbench-session.store'
import { useWidgetStore } from '../stores/widget.store'
import { wsClient } from '../services/ws-client'
import { UpdatesSidebar, type WorkbenchSessionTarget } from './UpdatesSidebar'
import { UpdatesConversation } from './UpdatesConversation'
import { UpdatesPreviewPanel } from './UpdatesPreviewPanel'
import './updates/updates-page.css'

export function UpdatesPage() {
  const activityGroups = useWidgetStore((state) => state.activityGroups)
  const activityLoading = useWidgetStore((state) => state.activitiesLoading)
  const activityError = useWidgetStore((state) => state.activitiesError)
  const fetchActivities = useWidgetStore((state) => state.fetchActivities)
  const setupActivityListeners = useWidgetStore((state) => state.setupListeners)
  const pinnedItems = useSessionDockStore((state) => state.items)
  const pinnedLoading = useSessionDockStore((state) => state.loading)
  const loadPinned = useSessionDockStore((state) => state.load)
  const setupPinnedListeners = useSessionDockStore((state) => state.setupListeners)
  const selectSession = useWorkbenchSessionStore((state) => state.select)
  const disposeSession = useWorkbenchSessionStore((state) => state.dispose)
  const messages = useWorkbenchSessionStore((state) => state.messages)
  const selectedSessionId = useWorkbenchSessionStore((state) => state.selectedSessionId)
  const [target, setTarget] = useState<WorkbenchSessionTarget | null>(null)
  const [previewCollapsed, setPreviewCollapsed] = useState(false)
  const selectionGeneration = useRef(0)

  useEffect(() => {
    void fetchActivities(); void loadPinned()
    const stopActivity = setupActivityListeners(); const stopPinned = setupPinnedListeners()
    const stopReconnect = wsClient.on('reconnected', () => {
      void fetchActivities(); void loadPinned({ silent: true })
      const sessionId = useWorkbenchSessionStore.getState().selectedSessionId
      if (sessionId) void useWorkbenchSessionStore.getState().select(sessionId)
    })
    return () => { stopActivity(); stopPinned(); stopReconnect(); disposeSession() }
  }, [fetchActivities, loadPinned, setupActivityListeners, setupPinnedListeners, disposeSession])

  const selectTarget = async (next: WorkbenchSessionTarget): Promise<void> => {
    const generation = ++selectionGeneration.current
    setTarget(next)
    await selectSession(next.sessionId)
    if (generation !== selectionGeneration.current) return
  }
  const refresh = (): void => { void Promise.all([fetchActivities(), loadPinned({ silent: true })]) }
  return <section className="wb-page"><UpdatesSidebar activityGroups={activityGroups} pinnedItems={pinnedItems} loading={activityLoading || pinnedLoading} error={activityError} selectedSessionId={selectedSessionId} onRefresh={refresh} onSelect={(next) => { void selectTarget(next) }} /><UpdatesConversation target={target} onSelectTarget={selectTarget} /><UpdatesPreviewPanel messages={messages} projectId={target?.projectId ?? null} sessionId={target?.sessionId ?? null} collapsed={previewCollapsed} onToggle={() => setPreviewCollapsed((value) => !value)} /></section>
}
