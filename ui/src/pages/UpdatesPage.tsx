import { useEffect, useRef, useState } from 'react'
import { useSessionDockStore } from '../stores/session-dock.store'
import { useWorkbenchSessionStore } from '../stores/workbench-session.store'
import { useWidgetStore } from '../stores/widget.store'
import { wsClient } from '../services/ws-client'
import { UpdatesSidebar, type WorkbenchSessionTarget } from './UpdatesSidebar'
import { UpdatesConversation } from './UpdatesConversation'
import { UpdatesPreviewPanel, type UpdatesPreviewFocus } from './UpdatesPreviewPanel'
import type { FilesPresentationInfo, PreviewPresentationInfo } from '../stores/session-events'
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
  const [previewFocus, setPreviewFocus] = useState<UpdatesPreviewFocus | null>(null)
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
    setPreviewFocus(null)
    await selectSession(next.sessionId)
    if (generation !== selectionGeneration.current) return
  }
  const refresh = (): void => { void Promise.all([fetchActivities(), loadPinned({ silent: true })]) }
  const openPreview = (preview: PreviewPresentationInfo): void => { setPreviewCollapsed(false); setPreviewFocus({ kind: 'preview', preview }) }
  const openFiles = (presentation: FilesPresentationInfo): void => { setPreviewCollapsed(false); setPreviewFocus({ kind: 'files', presentation }) }
  return <section className="wb-page"><UpdatesSidebar activityGroups={activityGroups} pinnedItems={pinnedItems} loading={activityLoading || pinnedLoading} error={activityError} selectedSessionId={selectedSessionId} onRefresh={refresh} onSelect={(next) => { void selectTarget(next) }} /><UpdatesConversation target={target} onSelectTarget={selectTarget} onOpenPreview={openPreview} onOpenFiles={openFiles} /><UpdatesPreviewPanel messages={messages} projectId={target?.projectId ?? null} sessionId={target?.sessionId ?? null} focus={previewFocus} onFocusConsumed={() => setPreviewFocus(null)} collapsed={previewCollapsed} onToggle={() => setPreviewCollapsed((value) => !value)} /></section>
}
